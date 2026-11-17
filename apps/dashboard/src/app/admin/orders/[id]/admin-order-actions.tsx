"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormInput, FormSelect, FormTextarea, formatCurrency, formatDate } from "@kisan4u/ui";
import {
  adminCancellationDecisionAction,
  confirmOrderAction,
  cancelPendingOrderAction,
  adminMarkInTransitAction,
  adminMarkDeliveredAction,
  adminMarkDeliveryFailedAction,
  recordPaymentCollectedAction,
  packAndSendToRapidShypAction,
  packAndSendToDelhiveryAction,
  packAndScheduleMockPickupAction,
  refreshRapidShypStatusAction,
  refreshDelhiveryStatusAction,
  acceptOrderAsAdminAction,
  decideReturnRequestAction,
  completeRefundAction,
  arrangeReturnPickupAction,
  adminLoadOrderPickupPointsAction,
  adminDispatchViaWizardAction,
  adminLoadOrderAddressAction,
  adminUpdateOrderAddressAction,
} from "../actions";
import { DispatchWizardLauncher } from "@/components/orders/dispatch-wizard-launcher";
import { RefundMethodPicker } from "@/components/orders/refund-method-picker";
import type { RefundChoice } from "@kisan4u/orders";
import { DELHIVERY_ACCOUNTS, type DelhiveryAccountKey } from "@/lib/logistics-partners";

const PAYMENT_COLLECTION_COPY: Record<string, { title: string; button: string }> = {
  COD: {
    title: "Cash on Delivery — record amount collected",
    button: "Record COD payment collected",
  },
  ONLINE_PARTIAL: { title: "Remaining balance due", button: "Mark remaining amount as paid" },
};

export type RapidShypShipmentInfo = {
  provider: "RAPIDSHYP" | "DELHIVERY";
  rapidshypOrderId: string | null;
  awbNumber: string | null;
  courierName: string | null;
  labelUrl: string | null;
  trackingStatusCode: string | null;
  trackingStatusDesc: string | null;
  lastSyncedAt: Date | null;
};

export type ReviewableRefundRequest = {
  id: string;
  status: "PENDING" | "APPROVED";
  reason: string;
  amount: unknown; // Prisma Decimal, serialized — always stringified before display
  refundMethod: "WALLET" | "ORIGINAL_SOURCE" | "BANK_TRANSFER";
  bankAccountHolderName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  /** Already resolved to absolute urls (page.tsx's resolveStorefrontAssetUrl) — apps/dashboard is a separate origin from apps/web, which is what actually serves these. */
  imageUrls: string[];
  videoUrl: string | null;
  /** Null means this refund covers the WHOLE cancelled order (cancellation.ts's decideCancellation), not one delivered item — see that column's own schema doc comment. Distinguishes the two panel labels below and gates the RapidShyp return-pickup panel, which only ever applies to a real per-item post-delivery return. */
  orderItemId: string | null;
};

const REFUND_METHOD_LABEL: Record<string, string> = {
  WALLET: "Kisan4U Wallet",
  ORIGINAL_SOURCE: "Same account customer paid with",
  BANK_TRANSFER: "Bank transfer",
};

export function AdminOrderActions({
  sellerOrderId,
  orderNumber,
  status,
  hasShipment,
  shipmentProvider,
  isCancellationRequested,
  paymentMethod,
  outstanding,
  sellerPickupPoints,
  deliveryMethod,
  rapidShypShipment,
  refundRequest,
  refundChoices,
  returnPickupInfo,
}: {
  sellerOrderId: string;
  orderNumber: string;
  status: string;
  hasShipment: boolean;
  /** order.shipment?.provider ?? null — once a shipment exists, this (not deliveryMethod) decides whether the manual PICKED_UP/IN_TRANSIT/DELIVERED/DELIVERY_FAILED buttons appear: a KISAN4U_COURIER order dispatched via the manual-logistics choice still gets them, one dispatched via RapidShyp never does (RapidShyp's own tracking poll drives those instead). */
  shipmentProvider: string | null;
  isCancellationRequested: boolean;
  /** Nothing is rendered for a fully-paid order (already-prepaid orders just show "Amount paid" in the Payment detail card above — see page.tsx) unless > 0. */
  paymentMethod: string;
  outstanding: number;
  /** This seller's own approved, active pickup points — only ever fetched (page.tsx) when status is CONFIRMED, which is exactly when "Accept on behalf of seller" can apply. Empty means the seller has none yet. */
  sellerPickupPoints: { id: string; name: string }[];
  /** RapidShyp only applies to KISAN4U_COURIER orders — a dealer TRANSPORT order never shows the "Send to RapidShyp" panel. */
  deliveryMethod: string;
  /** Set once this order's Shipment.provider === "RAPIDSHYP" — switches the panel from "Send" to "Refresh status". */
  rapidShypShipment?: RapidShypShipmentInfo | null;
  /** The one RefundRequest relevant to this order's CURRENT status — PENDING when status is RETURN_REQUESTED, APPROVED when status is RETURN_APPROVED/REFUND_INITIATED/CANCELLED (page.tsx picks the right one; at most one is ever active per order). Null otherwise. */
  refundRequest?: ReviewableRefundRequest | null;
  /** refundChoicesFor(...) for an APPROVED refundRequest — more than one means the admin picks the method from a dropdown. */
  refundChoices?: RefundChoice[] | null;
  /**
   * Deliberately DECOUPLED from refundRequest above — that lookup only
   * ever finds a PENDING/APPROVED row, so once a return's refund is fully
   * REFUNDED, refundRequest goes back to null even though the physical
   * item might still need a RapidShyp pickup scheduled. page.tsx computes
   * this independently: the most recent non-rejected, item-level (never a
   * whole-order cancellation refund) RefundRequest for this order, plus
   * whether Shipment.returnRapidshypOrderId is already set.
   */
  returnPickupInfo?: { refundRequestId: string; scheduled: boolean } | null;
}) {
  const router = useRouter();
  const hasRefundChoice = !!refundChoices && refundChoices.length > 1;
  // Free-text note shared by the cancellation approve/reject controls.
  const [note, setNote] = useState("");
  const [failReason, setFailReason] = useState("");
  const [showFail, setShowFail] = useState(false);
  const [collectAmount, setCollectAmount] = useState(String(outstanding));
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectSuccess, setCollectSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmNote, setConfirmNote] = useState("");
  const [showCancelPending, setShowCancelPending] = useState(false);
  const [cancelPendingReason, setCancelPendingReason] = useState("");
  const [pendingActionError, setPendingActionError] = useState<string | null>(null);
  const [isConfirmingOrder, startConfirmingOrder] = useTransition();
  const [showRapidShypForm, setShowRapidShypForm] = useState(false);
  const [packageLengthCm, setPackageLengthCm] = useState("");
  const [packageBreadthCm, setPackageBreadthCm] = useState("");
  const [packageHeightCm, setPackageHeightCm] = useState("");
  const [packageWeightGrams, setPackageWeightGrams] = useState("");
  const [rapidShypError, setRapidShypError] = useState<string | null>(null);
  const [isSendingToRapidShyp, startSendingToRapidShyp] = useTransition();
  const [isSchedulingMock, startSchedulingMock] = useTransition();
  const [showDelhiveryForm, setShowDelhiveryForm] = useState(false);
  const [isSendingToDelhivery, startSendingToDelhivery] = useTransition();
  const [isRefreshingDelhivery, startRefreshingDelhivery] = useTransition();
  const [delhiveryAccount, setDelhiveryAccount] = useState<DelhiveryAccountKey>("MARKETING1");
  const [isRefreshingRapidShyp, startRefreshingRapidShyp] = useTransition();
  const [acceptPickupPointId, setAcceptPickupPointId] = useState("");
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [isAccepting, startAccepting] = useTransition();
  const [returnNote, setReturnNote] = useState("");
  const [returnError, setReturnError] = useState<string | null>(null);
  const [isDecidingReturn, startDecidingReturn] = useTransition();
  const [returnWarning, setReturnWarning] = useState<string | null>(null);
  const [refundExternalReference, setRefundExternalReference] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [isCompletingRefund, startCompletingRefund] = useTransition();
  const [showReturnPickupForm, setShowReturnPickupForm] = useState(false);
  const [returnPickupLengthCm, setReturnPickupLengthCm] = useState("");
  const [returnPickupBreadthCm, setReturnPickupBreadthCm] = useState("");
  const [returnPickupHeightCm, setReturnPickupHeightCm] = useState("");
  const [returnPickupWeightGrams, setReturnPickupWeightGrams] = useState("");
  const [returnPickupError, setReturnPickupError] = useState<string | null>(null);
  const [isSchedulingReturnPickup, startSchedulingReturnPickup] = useTransition();
  // Derived, not a mount-time useState default. sellerPickupPoints is []
  // until the order reaches CONFIRMED (page.tsx only fetches it then), and
  // this component instance survives that transition without remounting —
  // approving the POS payment proof / recording a partial payment both
  // router.refresh() in place. A default captured by useState at mount
  // would stay "" even once the <select> has real options: the admin sees
  // a pickup point in the dropdown but the submit sends "" and hits
  // "Select a pickup point" despite a visible selection. Recompute every
  // render instead — keep the admin's own pick while it's still a valid
  // option, otherwise fall back to the first point.
  const effectiveAcceptPickupPointId = sellerPickupPoints.some((p) => p.id === acceptPickupPointId)
    ? acceptPickupPointId
    : (sellerPickupPoints[0]?.id ?? "");

  function handleCollectPayment() {
    setCollectError(null);
    setCollectSuccess(false);
    const amount = Number(collectAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCollectError("Enter an amount greater than zero.");
      return;
    }
    if (amount > outstanding + 0.01) {
      setCollectError(
        `Cannot collect more than the outstanding balance of ${formatCurrency(outstanding)}.`,
      );
      return;
    }
    startTransition(async () => {
      const result = await recordPaymentCollectedAction({ sellerOrderId, collectedAmount: amount });
      if (!result.ok) {
        setCollectError(result.error);
        return;
      }
      setCollectSuccess(true);
      router.refresh();
    });
  }

  function acceptOnBehalfOfSeller() {
    if (!effectiveAcceptPickupPointId) {
      setAcceptError("Select a pickup point.");
      return;
    }
    setAcceptError(null);
    startAccepting(async () => {
      const result = await acceptOrderAsAdminAction({
        sellerOrderId,
        pickupPointId: effectiveAcceptPickupPointId,
      });
      if (!result.ok) {
        setAcceptError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function decideReturn(approve: boolean) {
    if (!refundRequest) return;
    if (!approve && !returnNote.trim()) {
      setReturnError("A rejection reason is required.");
      return;
    }
    setReturnError(null);
    setReturnWarning(null);
    startDecidingReturn(async () => {
      const result = await decideReturnRequestAction(
        { refundRequestId: refundRequest.id, approve, note: returnNote || undefined },
        sellerOrderId,
      );
      if (!result.ok) {
        setReturnError(result.error);
        return;
      }
      if (result.warning) setReturnWarning(result.warning);
      router.refresh();
    });
  }

  function submitCompleteRefund(overrideRefundMethod?: "WALLET" | "ORIGINAL_SOURCE") {
    if (!refundRequest) return;
    setRefundError(null);
    startCompletingRefund(async () => {
      const result = await completeRefundAction(
        {
          refundRequestId: refundRequest.id,
          externalReference: refundExternalReference || undefined,
          overrideRefundMethod,
        },
        sellerOrderId,
      );
      if (!result.ok) {
        setRefundError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitReturnPickup() {
    if (!returnPickupInfo) return;
    setReturnPickupError(null);
    const entered = [
      returnPickupLengthCm,
      returnPickupBreadthCm,
      returnPickupHeightCm,
      returnPickupWeightGrams,
    ];
    const anyEntered = entered.some((v) => v.trim() !== "");
    const nums = entered.map(Number);
    // Dimensions are optional — the reverse pickup estimates package size
    // from the item when they're blank. If the admin fills some, they must
    // fill all four with positive numbers.
    if (anyEntered && !nums.every((n) => Number.isFinite(n) && n > 0)) {
      setReturnPickupError(
        "Leave all four blank to auto-estimate, or enter length, breadth, height (cm) and weight (g) greater than zero.",
      );
      return;
    }
    startSchedulingReturnPickup(async () => {
      const result = await arrangeReturnPickupAction(
        anyEntered
          ? {
              refundRequestId: returnPickupInfo.refundRequestId,
              packageLengthCm: nums[0],
              packageBreadthCm: nums[1],
              packageHeightCm: nums[2],
              packageWeightGrams: nums[3],
            }
          : { refundRequestId: returnPickupInfo.refundRequestId },
        sellerOrderId,
      );
      if (!result.ok) {
        setReturnPickupError(result.error);
        return;
      }
      setShowReturnPickupForm(false);
      router.refresh();
    });
  }

  function handleConfirmOrder() {
    setPendingActionError(null);
    startConfirmingOrder(async () => {
      const result = await confirmOrderAction(sellerOrderId, confirmNote || undefined);
      if (!result.ok) {
        setPendingActionError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleCancelPending() {
    if (cancelPendingReason.trim().length < 3) {
      setPendingActionError("Enter a reason for cancelling the order.");
      return;
    }
    setPendingActionError(null);
    startConfirmingOrder(async () => {
      const result = await cancelPendingOrderAction(sellerOrderId, cancelPendingReason.trim());
      if (!result.ok) {
        setPendingActionError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function decideCancellation(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await adminCancellationDecisionAction({
        sellerOrderId,
        approve,
        note: note || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function runLogisticsAction(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitSendToRapidShyp() {
    setRapidShypError(null);
    const length = Number(packageLengthCm);
    const breadth = Number(packageBreadthCm);
    const height = Number(packageHeightCm);
    const weight = Number(packageWeightGrams);
    if (![length, breadth, height, weight].every((n) => Number.isFinite(n) && n > 0)) {
      setRapidShypError("Enter length, breadth, height (cm) and weight (g) greater than zero.");
      return;
    }
    startSendingToRapidShyp(async () => {
      const result = await packAndSendToRapidShypAction({
        sellerOrderId,
        packageLengthCm: length,
        packageBreadthCm: breadth,
        packageHeightCm: height,
        packageWeightGrams: weight,
      });
      if (!result.ok) {
        setRapidShypError(result.error);
        return;
      }
      setShowRapidShypForm(false);
      router.refresh();
    });
  }

  function submitScheduleMockPickup() {
    setRapidShypError(null);
    startSchedulingMock(async () => {
      const result = await packAndScheduleMockPickupAction(sellerOrderId);
      if (!result.ok) {
        setRapidShypError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function refreshRapidShypStatus() {
    setRapidShypError(null);
    startRefreshingRapidShyp(async () => {
      const result = await refreshRapidShypStatusAction(sellerOrderId);
      if (!result.ok) {
        setRapidShypError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitSendToDelhivery() {
    setRapidShypError(null);
    const length = Number(packageLengthCm);
    const breadth = Number(packageBreadthCm);
    const height = Number(packageHeightCm);
    const weight = Number(packageWeightGrams);
    if (![length, breadth, height, weight].every((n) => Number.isFinite(n) && n > 0)) {
      setRapidShypError("Enter length, breadth, height (cm) and weight (g) greater than zero.");
      return;
    }
    startSendingToDelhivery(async () => {
      const result = await packAndSendToDelhiveryAction({
        sellerOrderId,
        delhiveryAccount,
        packageLengthCm: length,
        packageBreadthCm: breadth,
        packageHeightCm: height,
        packageWeightGrams: weight,
      });
      if (!result.ok) {
        setRapidShypError(result.error);
        return;
      }
      setShowDelhiveryForm(false);
      router.refresh();
    });
  }

  function refreshDelhiveryStatus() {
    setRapidShypError(null);
    startRefreshingDelhivery(async () => {
      const result = await refreshDelhiveryStatusAction(sellerOrderId);
      if (!result.ok) {
        setRapidShypError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function renderRefundEvidence(rr: ReviewableRefundRequest) {
    if (rr.imageUrls.length === 0 && !rr.videoUrl) return null;
    return (
      <div className="mb-2 flex flex-wrap gap-2">
        {rr.imageUrls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- customer-uploaded return-evidence photo from a separate origin (apps/web), not a static Next asset */}
            <img src={url} alt="Return evidence" className="h-full w-full object-cover" />
          </a>
        ))}
        {rr.videoUrl && (
          <a
            href={rr.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-surface-alt text-[10px] font-semibold text-gray-600"
          >
            ▶ Video
          </a>
        )}
      </div>
    );
  }

  const paymentCopy = PAYMENT_COLLECTION_COPY[paymentMethod] ?? {
    title: "Outstanding balance",
    button: "Record payment collected",
  };

  const isPendingConfirmation =
    status === "PENDING_PAYMENT" || status === "PAYMENT_PARTIALLY_RECEIVED";

  return (
    <div className="flex flex-col gap-4">
      {isPendingConfirmation && (
        <AlertBox tone="info" title="Confirm this order with the customer">
          <p className="mb-3 text-xs text-gray-600">
            The scheduling team calls the customer before an order goes to the seller. Confirming
            reserves stock and releases the order to the seller for dispatch. The seller cannot see
            this order until it is confirmed.
          </p>
          <FormTextarea
            label="Note (optional)"
            rows={2}
            value={confirmNote}
            onChange={(e) => setConfirmNote(e.target.value)}
            placeholder="e.g. Spoke to customer, delivery address confirmed"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmOrder}
              loading={isConfirmingOrder}
            >
              Confirm order
            </Button>
            {!showCancelPending && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowCancelPending(true);
                  setPendingActionError(null);
                }}
              >
                Cancel order
              </Button>
            )}
          </div>
          {showCancelPending && (
            <div className="mt-3 border-t border-border pt-3">
              <FormTextarea
                label="Reason for cancelling"
                rows={2}
                required
                value={cancelPendingReason}
                onChange={(e) => setCancelPendingReason(e.target.value)}
                placeholder="e.g. Customer no longer wants the order"
              />
              <p className="mt-1 text-xs text-gray-600">
                Any amount already paid (advance or full prepaid) is refunded automatically.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleCancelPending}
                  loading={isConfirmingOrder}
                >
                  Confirm cancellation
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCancelPending(false);
                    setCancelPendingReason("");
                    setPendingActionError(null);
                  }}
                >
                  Keep order
                </Button>
              </div>
            </div>
          )}
          {pendingActionError && (
            <p className="mt-2 text-xs font-medium text-danger">{pendingActionError}</p>
          )}
        </AlertBox>
      )}
      {/* Payment collection is automatic now — the advance/full amount is
          settled when the payment screenshot is approved or the gateway
          confirms it, and the remainder is collected on delivery
          (autoCompletePaymentOnDelivery). This panel stays only as a
          collapsed admin override for when something goes wrong; it is
          not part of the normal flow, so no "balance due" is surfaced
          on the page by default. */}
      {outstanding > 0.005 && status !== "CANCELLED" && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700">
            Record a payment collection manually (override)
          </summary>
          <div className="border-t border-border p-3">
            <AlertBox tone="warning" title={paymentCopy.title}>
              <p className="mb-2 text-xs text-gray-600">
                Only use this if the automatic paths didn&rsquo;t run — the advance/full amount is
                settled on screenshot approval or gateway confirmation, and the remainder is
                collected automatically on delivery.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <FormInput
                  label="Amount collected"
                  type="number"
                  min={0}
                  max={outstanding}
                  step="0.01"
                  value={collectAmount}
                  onChange={(e) => {
                    setCollectAmount(e.target.value);
                    setCollectSuccess(false);
                  }}
                  hint={`Outstanding: ${formatCurrency(outstanding)}`}
                  className="max-w-[160px]"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCollectPayment}
                  loading={isPending}
                >
                  {paymentCopy.button}
                </Button>
                {collectSuccess && (
                  <span className="text-xs font-semibold text-success">Recorded.</span>
                )}
              </div>
              {collectError && (
                <span role="alert" className="mt-1 block text-xs font-medium text-danger">
                  {collectError}
                </span>
              )}
            </AlertBox>
          </div>
        </details>
      )}

      {deliveryMethod === "KISAN4U_COURIER" &&
        (status === "SELLER_ACCEPTED" || status === "PACKED") &&
        !hasShipment && (
          <AlertBox tone="info" title="Dispatch — choose logistics">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  Option 1 — RapidShyp
                </p>
                {!showRapidShypForm ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowRapidShypForm(true)}
                    disabled={isSendingToRapidShyp || isSchedulingMock || isSendingToDelhivery}
                    className="self-start"
                  >
                    Send to RapidShyp
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-gray-600">
                      Package dimensions and weight aren&apos;t stored anywhere upstream — enter
                      them for this shipment.
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <FormInput
                        label="Length (cm)"
                        type="number"
                        min={0}
                        step="0.1"
                        value={packageLengthCm}
                        onChange={(e) => setPackageLengthCm(e.target.value)}
                        className="max-w-[120px]"
                      />
                      <FormInput
                        label="Breadth (cm)"
                        type="number"
                        min={0}
                        step="0.1"
                        value={packageBreadthCm}
                        onChange={(e) => setPackageBreadthCm(e.target.value)}
                        className="max-w-[120px]"
                      />
                      <FormInput
                        label="Height (cm)"
                        type="number"
                        min={0}
                        step="0.1"
                        value={packageHeightCm}
                        onChange={(e) => setPackageHeightCm(e.target.value)}
                        className="max-w-[120px]"
                      />
                      <FormInput
                        label="Weight (g)"
                        type="number"
                        min={0}
                        step="1"
                        value={packageWeightGrams}
                        onChange={(e) => setPackageWeightGrams(e.target.value)}
                        className="max-w-[120px]"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={submitSendToRapidShyp}
                        loading={isSendingToRapidShyp}
                      >
                        Confirm &amp; send
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRapidShypForm(false)}
                        disabled={isSendingToRapidShyp}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  Option 2 — Delhivery
                </p>
                <FormSelect
                  label="Delhivery account"
                  value={delhiveryAccount}
                  onChange={(e) => setDelhiveryAccount(e.target.value as DelhiveryAccountKey)}
                  className="max-w-[240px]"
                >
                  {DELHIVERY_ACCOUNTS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </FormSelect>
                {!showDelhiveryForm ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowDelhiveryForm(true)}
                    disabled={isSendingToRapidShyp || isSchedulingMock || isSendingToDelhivery}
                    className="self-start"
                  >
                    Send to Delhivery
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-gray-600">
                      Package dimensions and weight aren&apos;t stored anywhere upstream — enter
                      them for this shipment.
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <FormInput label="Length (cm)" type="number" min={0} step="0.1" value={packageLengthCm} onChange={(e) => setPackageLengthCm(e.target.value)} className="max-w-[120px]" />
                      <FormInput label="Breadth (cm)" type="number" min={0} step="0.1" value={packageBreadthCm} onChange={(e) => setPackageBreadthCm(e.target.value)} className="max-w-[120px]" />
                      <FormInput label="Height (cm)" type="number" min={0} step="0.1" value={packageHeightCm} onChange={(e) => setPackageHeightCm(e.target.value)} className="max-w-[120px]" />
                      <FormInput label="Weight (g)" type="number" min={0} step="1" value={packageWeightGrams} onChange={(e) => setPackageWeightGrams(e.target.value)} className="max-w-[120px]" />
                      <Button variant="primary" size="sm" onClick={submitSendToDelhivery} loading={isSendingToDelhivery}>
                        Confirm &amp; send
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setShowDelhiveryForm(false)} disabled={isSendingToDelhivery}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  Option 3 — Third party transport
                </p>
                <p className="text-xs text-gray-600">
                  For testing, or when RapidShyp isn&apos;t being used for this order — every step
                  from here on is marked by hand instead.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={submitScheduleMockPickup}
                  loading={isSchedulingMock}
                  disabled={isSendingToRapidShyp}
                  className="self-start"
                >
                  Use third party transport
                </Button>
              </div>
            </div>
            {rapidShypError && (
              <span role="alert" className="mt-1 block text-xs font-medium text-danger">
                {rapidShypError}
              </span>
            )}
          </AlertBox>
        )}

      {hasShipment &&
        (shipmentProvider === "RAPIDSHYP" || shipmentProvider === "DELHIVERY") &&
        (status === "PICKED_UP" || status === "IN_TRANSIT") && (
        <AlertBox tone="info" title="Delivery tracking">
          <p className="text-xs text-gray-600">
            Tracked automatically by the courier — no manual action needed. See the tracking
            history in the Shipment detail card above.
          </p>
        </AlertBox>
      )}

      {rapidShypShipment && (
        <AlertBox
          tone="info"
          title={`${rapidShypShipment.provider === "DELHIVERY" ? "Delhivery" : "RapidShyp"} tracking`}
        >
          <p className="mb-2 text-xs text-gray-600">
            {rapidShypShipment.courierName ?? "Courier not yet assigned"} ·{" "}
            {rapidShypShipment.trackingStatusDesc ?? "No status yet"}
            {rapidShypShipment.lastSyncedAt && (
              <> · last synced {formatDate(rapidShypShipment.lastSyncedAt, true)}</>
            )}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={rapidShypShipment.provider === "DELHIVERY" ? refreshDelhiveryStatus : refreshRapidShypStatus}
            loading={isRefreshingRapidShyp || isRefreshingDelhivery}
          >
            Refresh status
          </Button>
          {rapidShypShipment.labelUrl && (
            <a
              href={`/api/admin/orders/${sellerOrderId}/label`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-3 text-sm font-semibold text-green-700 hover:underline"
            >
              Download shipping label
            </a>
          )}
          {rapidShypError && (
            <span role="alert" className="mt-1 block text-xs font-medium text-danger">
              {rapidShypError}
            </span>
          )}
        </AlertBox>
      )}

      {hasShipment && shipmentProvider === "MOCK" && (status === "PICKED_UP" || status === "IN_TRANSIT") && (
        <AlertBox tone="info" title="Delivery tracking (admin)">
          <p className="mb-2 text-xs text-gray-600">
            Third party transport was chosen for this order, so there&apos;s no courier API to poll —
            the seller no longer advances this order past pickup, so admin does it here instead.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {status === "PICKED_UP" && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => runLogisticsAction(() => adminMarkInTransitAction(sellerOrderId))}
                loading={isPending}
              >
                Mark in transit
              </Button>
            )}
            {status === "IN_TRANSIT" && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => runLogisticsAction(() => adminMarkDeliveredAction(sellerOrderId))}
                loading={isPending}
              >
                Mark delivered
              </Button>
            )}
            {status === "IN_TRANSIT" && !showFail && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowFail(true)}
                disabled={isPending}
              >
                Mark delivery failed
              </Button>
            )}
          </div>
          {status === "IN_TRANSIT" && showFail && (
            <div className="mt-2 flex flex-col gap-2">
              <FormTextarea
                placeholder="Reason delivery failed"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={isPending || failReason.trim().length < 3}
                  onClick={() =>
                    runLogisticsAction(() =>
                      adminMarkDeliveryFailedAction(sellerOrderId, failReason),
                    )
                  }
                >
                  Confirm delivery failed
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFail(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </AlertBox>
      )}

      {isCancellationRequested && (
        <AlertBox tone="warning" title="Pending cancellation request">
          <div className="flex flex-wrap items-center gap-2">
            <FormInput
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => decideCancellation(true)}
              loading={isPending}
            >
              Approve cancellation
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => decideCancellation(false)}
              loading={isPending}
            >
              Reject cancellation
            </Button>
          </div>
        </AlertBox>
      )}

      {refundRequest?.status === "PENDING" && (
        <AlertBox
          tone="warning"
          title={
            refundRequest.orderItemId ? "Pending return request" : "Pending cancellation refund"
          }
        >
          <p className="mb-1 text-xs text-gray-600">
            Reason: {refundRequest.reason}
            <br />
            Refund method: {REFUND_METHOD_LABEL[refundRequest.refundMethod]} · Amount:{" "}
            {formatCurrency(refundRequest.amount as string)}
          </p>
          {!refundRequest.orderItemId && (
            <p className="mb-2 text-xs text-gray-600">
              Approving sends the refund now — the wallet-funded part back to the wallet, the rest
              by the method above.
            </p>
          )}
          {renderRefundEvidence(refundRequest)}
          {refundRequest.refundMethod === "BANK_TRANSFER" && (
            <p className="mb-2 text-xs text-gray-600">
              {refundRequest.bankAccountHolderName} · {refundRequest.bankAccountNumber} ·{" "}
              {refundRequest.bankIfsc}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <FormInput
              placeholder="Note (required to reject)"
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => decideReturn(true)}
              loading={isDecidingReturn}
            >
              {refundRequest.orderItemId ? "Approve return" : "Approve refund"}
            </Button>
            {refundRequest.orderItemId && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => decideReturn(false)}
                loading={isDecidingReturn}
              >
                Reject return
              </Button>
            )}
          </div>
          {returnError && (
            <span role="alert" className="mt-1 block text-xs font-medium text-danger">
              {returnError}
            </span>
          )}
        </AlertBox>
      )}

      {returnWarning && (
        <AlertBox tone="warning" className="mt-3">
          {returnWarning}
        </AlertBox>
      )}

      {refundRequest?.status === "APPROVED" && (
        <AlertBox
          tone="info"
          title={
            refundRequest.orderItemId
              ? "Complete refund"
              : status.startsWith("RTO")
                ? "Complete RTO refund"
                : "Complete cancellation refund"
          }
        >
          {hasRefundChoice ? null : (
            <p className="mb-2 text-xs text-gray-600">
              Refund method: {REFUND_METHOD_LABEL[refundRequest.refundMethod]} · Amount:{" "}
              {formatCurrency(refundRequest.amount as string)}
            </p>
          )}
          {renderRefundEvidence(refundRequest)}
          {hasRefundChoice ? (
            // More than one allowed method (POS: manual / wallet; nobody
            // picked one: wallet / Razorpay) — the admin chooses, same
            // dropdown as the orders tables. See refundChoicesFor.
            <RefundMethodPicker
              sellerOrderId={sellerOrderId}
              refundRequestId={refundRequest.id}
              kind={refundRequest.orderItemId ? "Return" : status.startsWith("RTO") ? "RTO" : "Cancellation"}
              amount={refundRequest.amount as string}
              choices={refundChoices ?? []}
            />
          ) : refundRequest.refundMethod === "WALLET" ? (
            <Button variant="primary" size="sm" onClick={() => submitCompleteRefund()} loading={isCompletingRefund}>
              Complete refund (credit wallet)
            </Button>
          ) : refundRequest.refundMethod === "ORIGINAL_SOURCE" ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-600">
                Leave blank to refund automatically via Razorpay (works if this order was paid
                through the real gateway) — only enter a reference to override with a manual
                refund done outside the system.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <FormInput
                  label="Manual reference (optional)"
                  value={refundExternalReference}
                  onChange={(e) => setRefundExternalReference(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => submitCompleteRefund()}
                  loading={isCompletingRefund}
                >
                  Complete refund
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <FormInput
                label="Payout reference (or manual transfer reference)"
                value={refundExternalReference}
                onChange={(e) => setRefundExternalReference(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => submitCompleteRefund()}
                loading={isCompletingRefund}
              >
                Mark refund completed
              </Button>
            </div>
          )}
          {refundError && (
            <span role="alert" className="mt-1 block text-xs font-medium text-danger">
              {refundError}
            </span>
          )}
        </AlertBox>
      )}

      {returnPickupInfo && shipmentProvider === "RAPIDSHYP" && !returnPickupInfo.scheduled && (
          <AlertBox tone="info" title="Schedule return pickup">
            <p className="mb-2 text-xs text-gray-600">
              This order was shipped via RapidShyp — arrange reverse pickup so a courier collects
              the returned item from the customer. A mock/manual-logistics order has no equivalent
              here; that return stays entirely manual.
            </p>
            {!showReturnPickupForm ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowReturnPickupForm(true)}
                disabled={isSchedulingReturnPickup}
              >
                Send return pickup to RapidShyp
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-gray-600">
                  Package dimensions and weight for this returned item — enter them for this pickup.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <FormInput
                    label="Length (cm)"
                    type="number"
                    min={0}
                    step="0.1"
                    value={returnPickupLengthCm}
                    onChange={(e) => setReturnPickupLengthCm(e.target.value)}
                    className="max-w-[120px]"
                  />
                  <FormInput
                    label="Breadth (cm)"
                    type="number"
                    min={0}
                    step="0.1"
                    value={returnPickupBreadthCm}
                    onChange={(e) => setReturnPickupBreadthCm(e.target.value)}
                    className="max-w-[120px]"
                  />
                  <FormInput
                    label="Height (cm)"
                    type="number"
                    min={0}
                    step="0.1"
                    value={returnPickupHeightCm}
                    onChange={(e) => setReturnPickupHeightCm(e.target.value)}
                    className="max-w-[120px]"
                  />
                  <FormInput
                    label="Weight (g)"
                    type="number"
                    min={0}
                    step="1"
                    value={returnPickupWeightGrams}
                    onChange={(e) => setReturnPickupWeightGrams(e.target.value)}
                    className="max-w-[120px]"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={submitReturnPickup}
                    loading={isSchedulingReturnPickup}
                  >
                    Confirm &amp; schedule
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowReturnPickupForm(false)}
                    disabled={isSchedulingReturnPickup}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {returnPickupError && (
              <span role="alert" className="mt-1 block text-xs font-medium text-danger">
                {returnPickupError}
              </span>
            )}
          </AlertBox>
        )}
      {returnPickupInfo?.scheduled && (
        <AlertBox tone="success" title="Return pickup scheduled">
          A courier has been requested via RapidShyp to collect this returned item.
        </AlertBox>
      )}

      {status === "CONFIRMED" && deliveryMethod === "KISAN4U_COURIER" && !hasShipment && (
        <AlertBox tone="info" title="Schedule dispatch">
          <p className="mb-2 text-xs text-gray-600">
            Open the Create Shipment wizard to pick a logistics partner and pickup warehouse — it
            accepts the order, marks it packed, and schedules pickup in one step.
          </p>
          <DispatchWizardLauncher
            sellerOrderId={sellerOrderId}
            orderNumber={orderNumber}
            paymentMethod={paymentMethod}
            variant="button"
            loadPickupPoints={adminLoadOrderPickupPointsAction}
            submit={adminDispatchViaWizardAction}
            loadAddress={adminLoadOrderAddressAction}
            updateAddress={adminUpdateOrderAddressAction}
          />
        </AlertBox>
      )}

      {status === "CONFIRMED" && deliveryMethod !== "KISAN4U_COURIER" && (
        <AlertBox tone="info" title="Accept on behalf of seller">
          {sellerPickupPoints.length === 0 ? (
            <p className="text-xs text-gray-600">
              This seller has no approved, active pickup point yet — ask them to add one before
              accepting on their behalf, or wait for them to accept it themselves from their own
              dashboard.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-gray-600">
                For a seller who hasn&apos;t acted yet — accepts the order and attaches one of
                their own pickup points, same as if they&apos;d clicked Accept themselves.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <FormSelect
                  label="Seller's pickup point"
                  value={effectiveAcceptPickupPointId}
                  onChange={(e) => setAcceptPickupPointId(e.target.value)}
                  className="!w-auto"
                >
                  {sellerPickupPoints.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </FormSelect>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={acceptOnBehalfOfSeller}
                  loading={isAccepting}
                >
                  Accept on behalf of seller
                </Button>
              </div>
              {acceptError && (
                <span role="alert" className="mt-1 block text-xs font-medium text-danger">
                  {acceptError}
                </span>
              )}
            </>
          )}
        </AlertBox>
      )}

      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
