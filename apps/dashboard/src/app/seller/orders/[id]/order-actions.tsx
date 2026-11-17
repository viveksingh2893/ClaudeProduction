"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormInput, FormSelect, FormTextarea } from "@kisan4u/ui";
import {
  acceptOrderAction,
  markPackedAndReadyForPickupAction,
  schedulePickupAction,
  packAndScheduleMockPickupAction,
  markPickedUpAction,
  sellerRejectOrderAction,
  packAndSendToRapidShypAction,
  packAndSendToDelhiveryAction,
  sellerLoadOrderPickupPointsAction,
  sellerDispatchViaWizardAction,
} from "../actions";
import { DispatchWizardLauncher } from "@/components/orders/dispatch-wizard-launcher";
import { DELHIVERY_ACCOUNTS, type DelhiveryAccountKey } from "@/lib/logistics-partners";

/**
 * Seller's own control stops at "picked up" for a manual/mock shipment —
 * everything from IN_TRANSIT onward is admin-only for those (see
 * apps/dashboard/src/app/admin/orders/[id]/admin-order-actions.tsx), a
 * stand-in for the real delivery-partner API/webhook that doesn't exist for
 * Own Transport. A RapidShyp shipment never reaches a manual button at all
 * past PICKUP_SCHEDULED — RapidShyp's own tracking poll drives PICKED_UP /
 * IN_TRANSIT / DELIVERED / DELIVERY_FAILED automatically (see
 * packages/orders/src/rapidshyp-shipping.ts), which is the whole point of
 * choosing it over manual/mock in the first place. The buyer gets an
 * in-app notification at every step either way (see
 * packages/orders/src/notifications.ts).
 */
export function OrderActions({
  sellerOrderId,
  orderNumber,
  paymentMethod,
  status,
  pickupPoints,
  deliveryMethod,
  shipmentProvider,
}: {
  sellerOrderId: string;
  orderNumber: string;
  paymentMethod: string;
  status: string;
  pickupPoints: { id: string; name: string }[];
  /** Only KISAN4U_COURIER orders ever get a RapidShyp-or-mock choice — a TRANSPORT (dealer own-transport) order keeps its single "Mark packed & ready for pickup" action, unchanged. */
  deliveryMethod: string;
  /** order.shipment?.provider ?? null — once a shipment exists, this (not deliveryMethod) decides whether the manual pickup button appears: a KISAN4U_COURIER order dispatched via the mock choice still gets it, one dispatched via RapidShyp never does. */
  shipmentProvider: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pickupPointId, setPickupPointId] = useState("");
  // Derived, not a mount-time useState default: an instance that mounted
  // while pickupPoints was [] (seller had none yet) keeps running as new
  // props arrive on router.refresh() without remounting, so a captured ""
  // would leave the <select> showing a point while accept/schedule submit
  // "". Keep the seller's own pick while it's a valid option, else first.
  const effectivePickupPointId = pickupPoints.some((p) => p.id === pickupPointId)
    ? pickupPointId
    : (pickupPoints[0]?.id ?? "");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [isPending, startTransition] = useTransition();
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
  const [delhiveryAccount, setDelhiveryAccount] = useState<DelhiveryAccountKey>("MARKETING1");

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
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

  /**
   * Shared by the SELLER_ACCEPTED and PACKED render branches below for a
   * KISAN4U_COURIER order — same panel either way, since PACKED is only
   * ever reached here as a recovery state (see packAndSendToRapidShyp /
   * packAndScheduleMockPickup: both pack-then-dispatch in one call, so a
   * seller normally never sees PACKED sit still long enough to matter).
   */
  function renderDispatchChoice() {
    return (
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
            <>
              <p className="text-xs text-gray-600">
                Package dimensions and weight aren&apos;t stored anywhere upstream — enter them
                for this shipment.
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
            </>
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
            <>
              <p className="text-xs text-gray-600">
                Package dimensions and weight aren&apos;t stored anywhere upstream — enter them
                for this shipment.
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
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Option 3 — Third party transport
          </p>
          <p className="text-xs text-gray-600">
            For testing, or when RapidShyp isn&apos;t being used for this order — you (or admin)
            mark each step by hand from here on.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={submitScheduleMockPickup}
            loading={isSchedulingMock}
            disabled={isSendingToRapidShyp || isSendingToDelhivery}
            className="self-start"
          >
            Use third party transport
          </Button>
        </div>

        {rapidShypError && <AlertBox tone="danger">{rapidShypError}</AlertBox>}
      </div>
    );
  }

  if (status === "CONFIRMED") {
    return (
      <div className="flex flex-col gap-3">
        {deliveryMethod === "KISAN4U_COURIER" ? (
          pickupPoints.length === 0 ? (
            <AlertBox tone="danger">
              You have no approved, active pickup points yet — add one before dispatching orders.
            </AlertBox>
          ) : (
            <div>
              <p className="mb-2 text-xs text-gray-600">
                Open the Create Shipment wizard to choose a logistics partner and pickup warehouse.
                It accepts the order, marks it packed, and schedules pickup in one step.
              </p>
              <DispatchWizardLauncher
                sellerOrderId={sellerOrderId}
                orderNumber={orderNumber}
                paymentMethod={paymentMethod}
                variant="button"
                loadPickupPoints={sellerLoadOrderPickupPointsAction}
                submit={sellerDispatchViaWizardAction}
              />
            </div>
          )
        ) : pickupPoints.length === 0 ? (
          <AlertBox tone="danger">
            You have no approved, active pickup points yet — add one before accepting orders.
          </AlertBox>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <FormSelect
              label="Pickup point"
              value={effectivePickupPointId}
              onChange={(e) => setPickupPointId(e.target.value)}
              className="!w-auto"
            >
              {pickupPoints.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </FormSelect>
            <Button
              variant="primary"
              disabled={isPending}
              onClick={() =>
                run(() =>
                  acceptOrderAction({ sellerOrderId, pickupPointId: effectivePickupPointId }),
                )
              }
              loading={isPending}
            >
              Accept order
            </Button>
          </div>
        )}

        {!showReject ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowReject(true)}
            className="self-start"
          >
            Reject order
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <FormTextarea
              placeholder="Reason for rejecting this order"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={isPending || rejectReason.trim().length < 3}
                onClick={() =>
                  run(() => sellerRejectOrderAction({ sellerOrderId, reason: rejectReason }))
                }
              >
                Confirm rejection
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReject(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <AlertBox tone="danger">{error}</AlertBox>}
      </div>
    );
  }

  if (status === "SELLER_ACCEPTED") {
    if (deliveryMethod !== "KISAN4U_COURIER") {
      return (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            disabled={isPending}
            loading={isPending}
            onClick={() => run(() => markPackedAndReadyForPickupAction({ sellerOrderId }))}
          >
            Mark packed &amp; ready for pickup
          </Button>
          <p className="text-xs text-gray-500">The buyer is notified as soon as this is done.</p>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
        </div>
      );
    }
    return renderDispatchChoice();
  }

  if (status === "PACKED") {
    // Recovery-only state for a KISAN4U_COURIER order — the normal path
    // (renderDispatchChoice from SELLER_ACCEPTED) packs and dispatches in
    // one click, so this only shows up if the dispatch half of that
    // failed after packing succeeded. Same panel either way.
    if (deliveryMethod === "KISAN4U_COURIER") return renderDispatchChoice();

    return (
      <div className="flex flex-col gap-2">
        {pickupPoints.length === 0 ? (
          <AlertBox tone="danger">
            You have no approved, active pickup points yet — add one, then come back here to
            schedule pickup.
          </AlertBox>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <FormSelect
              label="Pickup point"
              value={effectivePickupPointId}
              onChange={(e) => setPickupPointId(e.target.value)}
              className="!w-auto"
            >
              {pickupPoints.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </FormSelect>
            <Button
              variant="primary"
              disabled={isPending}
              loading={isPending}
              onClick={() =>
                run(() =>
                  schedulePickupAction({ sellerOrderId, pickupPointId: effectivePickupPointId }),
                )
              }
            >
              Schedule pickup
            </Button>
          </div>
        )}
        <p className="text-xs text-gray-500">
          This requests pickup and notifies the buyer. The pickup point above is only used if this
          order doesn't already have one set.
        </p>
        {error && <AlertBox tone="danger">{error}</AlertBox>}
      </div>
    );
  }

  if (status === "PICKUP_SCHEDULED") {
    if (shipmentProvider === "RAPIDSHYP" || shipmentProvider === "DELHIVERY") {
      return (
        <p className="text-sm text-gray-500">
          Tracked automatically by the courier — no action needed here. See the tracking history
          above for updates as they arrive.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          disabled={isPending}
          loading={isPending}
          onClick={() => run(() => markPickedUpAction(sellerOrderId))}
        >
          Mark picked up
        </Button>
        {error && <AlertBox tone="danger">{error}</AlertBox>}
      </div>
    );
  }

  return (
    <p className="text-sm text-gray-500">Delivery from here on is tracked by Kisan4U admin.</p>
  );
}
