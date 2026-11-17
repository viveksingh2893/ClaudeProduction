"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormTextarea, formatCurrency, formatDate } from "@kisan4u/ui";
import { decidePosPaymentProofAction } from "@/app/admin/orders/actions";

export type PosPaymentProofSlot = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  amount: unknown; // Prisma Decimal, serialized — always stringified before display
  uploadedAt: Date;
};

/**
 * Approve/reject ONE POS payment-proof screenshot ("slot") — the entire
 * job of the restricted "Payment Verifier" staff role (see
 * apps/dashboard/src/app/admin/payment-verification), and also embedded
 * inside the full admin order-detail page's action panel
 * (payment-summary.tsx) so both surfaces share one implementation. A
 * buyer paying in instalments has several concurrent live slots — render
 * one of these per slot; deciding one never touches the others.
 */
export function ProofDecisionPanel({
  checkoutGroupId,
  sellerOrderId,
  proof: latestProof,
}: {
  checkoutGroupId: string;
  sellerOrderId?: string;
  proof: PosPaymentProofSlot;
}) {
  const router = useRouter();
  const [proofReason, setProofReason] = useState("");
  const [proofError, setProofError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decideProof(action: "APPROVE" | "REJECT") {
    setProofError(null);
    startTransition(async () => {
      const result = await decidePosPaymentProofAction(
        { submissionId: latestProof.id, action, reason: proofReason || undefined },
        { checkoutGroupId, sellerOrderId },
      );
      if (!result.ok) {
        setProofError(result.error);
        return;
      }
      setProofReason("");
      router.refresh();
    });
  }

  return (
    <AlertBox
      tone={
        latestProof.status === "APPROVED"
          ? "success"
          : latestProof.status === "REJECTED"
            ? "danger"
            : "warning"
      }
      title={
        latestProof.status === "APPROVED"
          ? "POS payment proof — approved"
          : latestProof.status === "REJECTED"
            ? "POS payment proof — rejected"
            : "POS payment proof — pending review"
      }
    >
      <img
        src={`/api/pos/payment-proofs/${latestProof.id}`}
        alt="Uploaded payment screenshot"
        className="mb-2 max-w-xs rounded border border-border"
      />
      <p className="mb-2 text-xs text-gray-600">
        Agent claims {formatCurrency(String(latestProof.amount))} collected · uploaded{" "}
        {formatDate(latestProof.uploadedAt, true)}
      </p>
      {latestProof.status === "REJECTED" && (
        <p className="mb-2 text-xs text-danger">
          Reason: {latestProof.rejectionReason} — this stays until the agent uploads a
          replacement.
        </p>
      )}
      {latestProof.status === "PENDING" && (
        <>
          <FormTextarea
            placeholder="Rejection reason (required to reject)"
            value={proofReason}
            onChange={(e) => setProofReason(e.target.value)}
            rows={2}
          />
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={isPending}
              loading={isPending}
              onClick={() => decideProof("APPROVE")}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isPending || proofReason.trim().length === 0}
              onClick={() => decideProof("REJECT")}
            >
              Reject
            </Button>
          </div>
          {proofError && (
            <span role="alert" className="mt-1 block text-xs font-medium text-danger">
              {proofError}
            </span>
          )}
        </>
      )}
    </AlertBox>
  );
}
