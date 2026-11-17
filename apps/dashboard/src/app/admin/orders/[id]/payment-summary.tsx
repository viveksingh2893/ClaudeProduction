"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, Card, FormTextarea, formatCurrency, formatDate } from "@kisan4u/ui";
import { CircleCheck, Truck, ImageIcon } from "lucide-react";
import { decidePosPaymentProofAction } from "../actions";
import { uploadPosPaymentProofAction } from "../../pos/orders/actions";

export type OnlinePaymentDetail = {
  amount: number;
  methodLabel: string;
  transactionId: string;
  paidOn: Date | string;
};

export type PosProofDetail = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  amount: number;
  uploadedByName: string;
  uploadedAt: Date | string;
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "success";
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={`text-lg font-extrabold ${
          tone === "warning" ? "text-amber-600" : tone === "success" ? "text-green-700" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** The "Paid Online" summary card (organic/website orders, and any POS order's non-proof online portion) — a simplified customer-facing snapshot; the full per-payment allocation ledger stays in the "Payment detail" section further down the page for anyone who needs it. */
function PaidOnlineCard({ detail }: { detail: OnlinePaymentDetail }) {
  return (
    <Card className="border-green-200 bg-green-50/60 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-green-800">
        <CircleCheck className="h-4 w-4" aria-hidden="true" /> Paid Online
      </div>
      <div className="text-2xl font-extrabold text-ink">{formatCurrency(detail.amount)}</div>
      <div className="mt-1 text-xs text-gray-600">Payment Status: Success</div>
      <dl className="mt-3 flex flex-col gap-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Payment Method</dt>
          <dd className="font-semibold text-ink">{detail.methodLabel}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Transaction ID</dt>
          <dd className="font-mono font-semibold text-ink">{detail.transactionId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Paid On</dt>
          <dd className="font-semibold text-ink">{formatDate(detail.paidOn, true)}</dd>
        </div>
      </dl>
      <a
        href="#payment-detail"
        className="mt-3 inline-block rounded-md border border-green-600 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100"
      >
        View Payment Details
      </a>
    </Card>
  );
}

/** The "To Collect on Delivery" card — shown whenever a real balance is still outstanding, for either channel. Always reads "Pending Collection": the outstanding figure it's given already nets out anything actually collected (see page.tsx's outstanding calc), so if it's shown at all, collection is by definition still pending. */
function CodCard({ amount }: { amount: number }) {
  return (
    <Card className="border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-2 text-sm font-bold text-amber-700">To Collect on Delivery</div>
      <div className="text-2xl font-extrabold text-amber-700">{formatCurrency(amount)}</div>
      <dl className="mt-3 flex flex-col gap-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Collection Method</dt>
          <dd className="font-semibold text-ink">Cash on Delivery</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Collection Status</dt>
          <dd className="font-semibold text-ink">Pending Collection</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-gray-500">
        Will be collected by delivery partner at the time of delivery.
      </p>
    </Card>
  );
}

function ProofReviewCard({
  checkoutGroupId,
  sellerOrderId,
  proof,
}: {
  checkoutGroupId: string;
  sellerOrderId: string;
  proof: PosProofDetail;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(action: "APPROVE" | "REJECT") {
    setError(null);
    startTransition(async () => {
      const result = await decidePosPaymentProofAction(
        { submissionId: proof.id, action, reason: reason || undefined },
        { checkoutGroupId, sellerOrderId },
      );
      if (!result.ok) return setError(result.error);
      setReason("");
      router.refresh();
    });
  }

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-bold text-ink">
        Payment Proof — {formatCurrency(proof.amount)}
      </h3>
      <div className="flex flex-col gap-4 sm:flex-row">
        <img
          src={`/api/pos/payment-proofs/${proof.id}`}
          alt="Uploaded payment screenshot"
          className="h-40 w-32 shrink-0 rounded-lg border border-border object-cover"
        />
        <div className="flex-1">
          <div className="text-xs text-gray-500">Uploaded by</div>
          <div className="text-sm font-semibold text-ink">{proof.uploadedByName} (POS)</div>
          <div className="mt-2 text-xs text-gray-500">Uploaded on</div>
          <div className="text-sm font-semibold text-ink">{formatDate(proof.uploadedAt, true)}</div>
          <a
            href={`/api/pos/payment-proofs/${proof.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-green-600 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> View Full Image
          </a>

          {proof.status === "PENDING" && (
            <>
              <FormTextarea
                placeholder="Rejection reason (required to reject)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-4"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                  loading={isPending}
                  onClick={() => decide("APPROVE")}
                >
                  Approve Payment
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={isPending || reason.trim().length === 0}
                  onClick={() => decide("REJECT")}
                >
                  Reject Payment
                </Button>
              </div>
              {error && (
                <span role="alert" className="mt-1 block text-xs font-medium text-danger">
                  {error}
                </span>
              )}
            </>
          )}
          {proof.status === "REJECTED" && (
            <p className="mt-3 text-xs text-danger">
              Rejected: {proof.rejectionReason} — stays until a replacement is uploaded.
            </p>
          )}
          {proof.status === "APPROVED" && (
            <p className="mt-3 text-xs font-semibold text-green-700">
              Approved — this order can proceed to dispatch.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function UploadProofCard({
  checkoutGroupId,
  replacesSubmissionId,
  defaultAmount,
  title,
}: {
  checkoutGroupId: string;
  replacesSubmissionId?: string;
  defaultAmount?: number;
  title: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("amount", amount);
    if (replacesSubmissionId) formData.set("replacesSubmissionId", replacesSubmissionId);
    startTransition(async () => {
      const result = await uploadPosPaymentProofAction(checkoutGroupId, formData);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <AlertBox tone="info" title={title}>
      <p className="mb-2 text-xs text-gray-600">
        Upload the screenshot yourself if you&apos;ve collected it from the agent directly — same
        review as when the agent uploads it themselves.
      </p>
      <label className="mb-2 block text-xs font-semibold text-gray-600">
        Amount this screenshot covers
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 block w-32 rounded-md border border-border px-2 py-1 text-sm"
        />
      </label>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={isPending || !(Number(amount) > 0)}
        loading={isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        {isPending ? "Uploading…" : "Choose screenshot"}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        disabled={isPending}
        className="hidden"
      />
      {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
    </AlertBox>
  );
}

/**
 * Two distinct presentations sharing one component (rather than two
 * near-duplicate files) since they're the same underlying data — live
 * amount paid/outstanding, same money math as page.tsx's amountPaid/
 * outstanding/paymentMethod — differing only in which parts of it matter
 * for this channel. `proof` is only ever set for a POS order (placedByUserId
 * set) with a non-COD payment (see page.tsx) — a POS order paid entirely by
 * COD renders through the same Paid-Online/COD-card path an organic order
 * does, just under the "(POS Order)" heading.
 */
export function PaymentSummary({
  channel,
  sellerOrderId,
  orderTotal,
  amountPaid,
  outstanding,
  paymentMethodLabel,
  onlinePayment,
  posCheckoutGroupId,
  liveProofs,
}: {
  channel: "WEBSITE" | "POS";
  sellerOrderId: string;
  orderTotal: number;
  amountPaid: number;
  outstanding: number;
  paymentMethodLabel: string;
  onlinePayment: OnlinePaymentDetail | null;
  posCheckoutGroupId?: string | null;
  liveProofs: PosProofDetail[];
}) {
  const isPos = channel === "POS";
  const showProofFlow = isPos && !!posCheckoutGroupId;
  const anyPending = liveProofs.some((p) => p.status === "PENDING");
  const allApproved = liveProofs.length > 0 && liveProofs.every((p) => p.status === "APPROVED");

  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-green-800">
        <Truck className="h-4 w-4" aria-hidden="true" />
        Payment Summary ({isPos ? "POS Order" : "Organic Order"})
      </h2>

      {showProofFlow && anyPending && (
        <div className="mb-4">
          <AlertBox tone="warning" title="Payment verification required">
            {liveProofs.length > 1
              ? "This POS order has multiple payment screenshots. Every one of them must be approved before the order can proceed."
              : "POS order payment is pending verification. Please review payment proof and take action."}
          </AlertBox>
        </div>
      )}

      {showProofFlow && (
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Order Total" value={formatCurrency(orderTotal)} />
          <Stat label="Payment Received" value={formatCurrency(amountPaid)} tone="success" />
          <Stat
            label="Balance to Collect"
            value={formatCurrency(outstanding)}
            tone={outstanding > 0.005 ? "warning" : undefined}
          />
          <Stat label="Payment Method" value={paymentMethodLabel} />
        </div>
      )}

      {showProofFlow &&
        liveProofs.map((proof) => (
          <div key={proof.id} className="mb-3">
            <ProofReviewCard checkoutGroupId={posCheckoutGroupId!} sellerOrderId={sellerOrderId} proof={proof} />
            {proof.status === "REJECTED" && (
              <div className="mt-2">
                <UploadProofCard
                  checkoutGroupId={posCheckoutGroupId!}
                  replacesSubmissionId={proof.id}
                  defaultAmount={proof.amount}
                  title="Upload replacement screenshot"
                />
              </div>
            )}
          </div>
        ))}
      {showProofFlow && !allApproved && (
        <div className="mb-3">
          <UploadProofCard
            checkoutGroupId={posCheckoutGroupId!}
            title={liveProofs.length === 0 ? "Upload payment proof" : "Add another screenshot"}
          />
        </div>
      )}
      {showProofFlow && anyPending && (
        <AlertBox tone="success">
          After every screenshot is approved, remaining balance of {formatCurrency(outstanding)}{" "}
          will be marked for collection on delivery.
        </AlertBox>
      )}

      {!showProofFlow && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {onlinePayment && <PaidOnlineCard detail={onlinePayment} />}
            {outstanding > 0.005 && <CodCard amount={outstanding} />}
          </div>
          {onlinePayment && outstanding > 0.005 && (
            <div className="mt-4">
              <AlertBox tone="info">
                This is a partial payment order. {formatCurrency(onlinePayment.amount)} paid online
                and {formatCurrency(outstanding)} to be collected on delivery.
              </AlertBox>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
