"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, Card, formatCurrency, formatDate } from "@kisan4u/ui";
import { uploadPosPaymentProofAction } from "../actions";

export type LiveSubmission = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  amount: number;
  uploadedAt: Date;
};

/**
 * A buyer paying in instalments (e.g. 1000 collected as 200+300+500)
 * means several independent screenshot "slots" can be live at once — one
 * card per slot below, each with its own amount and its own
 * approve/reject outcome. Only a REJECTED slot gets a re-upload control
 * (chained to that specific slot via replacesSubmissionId so every other
 * slot is untouched); a brand-new "Add another screenshot" control opens
 * a fresh slot. The order isn't proof-approved until EVERY slot here is
 * APPROVED — the running total below makes that visible at a glance.
 */
export function PaymentProofPanel({
  checkoutGroupId,
  orderTotal,
  submissions,
}: {
  checkoutGroupId: string;
  orderTotal: number;
  submissions: LiveSubmission[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [isPending, startTransition] = useTransition();

  const approvedTotal = submissions
    .filter((s) => s.status === "APPROVED")
    .reduce((sum, s) => sum + s.amount, 0);
  const remaining = Math.max(0, Math.round((orderTotal - approvedTotal + Number.EPSILON) * 100) / 100);
  const allApproved =
    submissions.length > 0 &&
    submissions.every((s) => s.status === "APPROVED") &&
    remaining <= 0.01;
  const hasPendingOrRejected = submissions.some((s) => s.status !== "APPROVED");

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await uploadPosPaymentProofAction(checkoutGroupId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddingNew(false);
      router.refresh();
    });
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-bold text-ink">Payment proof</h2>
      <p className="mb-3 text-xs text-gray-600">
        {allApproved
          ? `All screenshots approved — ${formatCurrency(approvedTotal.toFixed(2))} confirmed.`
          : `${formatCurrency(approvedTotal.toFixed(2))} approved so far of ${formatCurrency(orderTotal.toFixed(2))} — ${formatCurrency(remaining.toFixed(2))} still needs a screenshot.`}
      </p>

      <div className="flex flex-col gap-3">
        {submissions.map((s) => (
          <ProofSlot key={s.id} submission={s} isPending={isPending} onSubmit={submit} />
        ))}
      </div>

      {!allApproved && hasPendingOrRejected && (
        <p className="mt-3 text-xs text-gray-500">
          Every screenshot above must be approved before this order can be confirmed.
        </p>
      )}
      {!allApproved && !hasPendingOrRejected && remaining > 0.01 && (
        <p className="mt-3 text-xs text-gray-500">
          All uploaded screenshots are approved, but {formatCurrency(remaining.toFixed(2))} is still
          uncovered — add another screenshot for the rest.
        </p>
      )}

      <div className="mt-3">
        {addingNew ? (
          <NewSlotForm isPending={isPending} onSubmit={submit} onCancel={() => setAddingNew(false)} />
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAddingNew(true)}>
            {submissions.length === 0 ? "Choose screenshot" : "+ Add another screenshot"}
          </Button>
        )}
        {error && <AlertBox tone="danger" className="mt-2">{error}</AlertBox>}
      </div>
    </Card>
  );
}

function ProofSlot({
  submission,
  isPending,
  onSubmit,
}: {
  submission: LiveSubmission;
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(String(submission.amount));

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("amount", amount);
    formData.set("replacesSubmissionId", submission.id);
    onSubmit(formData);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{formatCurrency(submission.amount.toFixed(2))}</span>
        {submission.status === "PENDING" && (
          <span className="text-xs font-semibold text-warning">Awaiting review</span>
        )}
        {submission.status === "APPROVED" && (
          <span className="text-xs font-semibold text-success">Approved</span>
        )}
        {submission.status === "REJECTED" && (
          <span className="text-xs font-semibold text-danger">Rejected</span>
        )}
      </div>
      <p className="text-xs text-gray-500">Uploaded {formatDate(submission.uploadedAt, true)}</p>
      <img
        src={`/api/pos/payment-proofs/${submission.id}`}
        alt="Uploaded payment screenshot"
        className="mt-2 max-w-xs rounded border border-border"
      />
      {submission.status === "REJECTED" && (
        <>
          <AlertBox tone="danger" title="Rejected — upload a replacement below" className="mt-2">
            {submission.rejectionReason}
          </AlertBox>
          {replacing ? (
            <div className="mt-2 flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-600">
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
                {isPending ? "Uploading…" : "Choose replacement screenshot"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                disabled={isPending}
                className="hidden"
              />
            </div>
          ) : (
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setReplacing(true)}>
              Upload replacement
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function NewSlotForm({
  isPending,
  onSubmit,
  onCancel,
}: {
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState("");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("amount", amount);
    onSubmit(formData);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <label className="text-xs font-semibold text-gray-600">
        Amount this screenshot covers (e.g. if the customer paid ₹1000 in parts, enter just this
        part's amount)
        <input
          type="number"
          min="0.01"
          step="0.01"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 block w-32 rounded-md border border-border px-2 py-1 text-sm"
        />
      </label>
      <div className="flex gap-2">
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
        <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        disabled={isPending}
        className="hidden"
      />
    </div>
  );
}
