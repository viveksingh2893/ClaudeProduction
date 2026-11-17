"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import type { BaBankStatus } from "@kisan4u/db";
import { AlertBox, Badge, Button, Card, ConfirmDialog, FormTextarea, formatDate } from "@kisan4u/ui";
import { DocumentViewerButton } from "@/components/document-viewer-button";
import { decideBaBankAction } from "../actions";

const STATUS_BADGE: Record<BaBankStatus, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  NOT_SUBMITTED: { label: "Not submitted", tone: "neutral" },
  PENDING_APPROVAL: { label: "Pending review", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

/**
 * Read-only view of what a BA submitted on Form 2 (PAN/bank/IFSC + the two
 * uploaded documents) plus the admin approve/reject decision on it —
 * separate from BaDetailClient below it, which is the EDIT form. Payout
 * (see packages/orders/src/ba/settlement.ts) only unlocks once this is
 * APPROVED, not merely submitted.
 */
export function BankReviewPanel({
  baId,
  bankStatus,
  bankSubmittedAt,
  bankReviewedAt,
  bankRejectionReason,
  panNumber,
  bankName,
  bankBranch,
  accountHolderName,
  accountNumber,
  ifsc,
  panDocUrl,
  chequeDocUrl,
}: {
  baId: string;
  bankStatus: BaBankStatus;
  bankSubmittedAt: Date | string | null;
  bankReviewedAt: Date | string | null;
  bankRejectionReason: string | null;
  panNumber: string | null;
  bankName: string | null;
  bankBranch: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  panDocUrl: string | null;
  chequeDocUrl: string | null;
}) {
  const router = useRouter();
  const [confirmReject, setConfirmReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "APPROVE" | "REJECT", actReason?: string) {
    setError(null);
    startTransition(async () => {
      const res = await decideBaBankAction({ baId, decision, reason: actReason || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmReject(false);
      setReason("");
      router.refresh();
    });
  }

  if (bankStatus === "NOT_SUBMITTED") return null;

  const badge = STATUS_BADGE[bankStatus];

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-green-800">
          Submitted bank &amp; KYC details
        </h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Field label="PAN number" value={panNumber} />
        <Field label="IFSC code" value={ifsc} />
        <Field label="Bank name" value={bankName} />
        <Field label="Bank branch" value={bankBranch} />
        <Field label="Account holder" value={accountHolderName} />
        <Field label="Account number" value={accountNumber} />
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <div>
          <span className="mr-1 text-gray-500">PAN card copy:</span>
          <DocumentViewerButton url={panDocUrl} label="PAN card copy" />
        </div>
        <div>
          <span className="mr-1 text-gray-500">Cancelled cheque:</span>
          <DocumentViewerButton url={chequeDocUrl} label="Cancelled cheque" />
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        {bankSubmittedAt && <div>Submitted {formatDate(bankSubmittedAt, true)}</div>}
        {bankReviewedAt && <div>Reviewed {formatDate(bankReviewedAt, true)}</div>}
      </div>

      {bankStatus === "REJECTED" && bankRejectionReason && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Reason: {bankRejectionReason}
        </p>
      )}

      {bankStatus === "PENDING_APPROVAL" && (
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() => decide("APPROVE")}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Approve bank details
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={isPending}
            onClick={() => setConfirmReject(true)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}

      {error && !confirmReject && (
        <AlertBox tone="danger" className="mt-3">
          {error}
        </AlertBox>
      )}

      <ConfirmDialog
        open={confirmReject}
        onClose={() => {
          setConfirmReject(false);
          setReason("");
        }}
        onConfirm={() => decide("REJECT", reason)}
        title="Reject these bank details?"
        confirmLabel="Reject"
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            <span>The BA will see this reason and can resubmit corrected details.</span>
            <FormTextarea
              label="Reason"
              hint="Required"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gray-50 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-ink">{value || "—"}</span>
    </div>
  );
}
