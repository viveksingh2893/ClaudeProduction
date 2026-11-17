"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, Card, FormTextarea } from "@kisan4u/ui";
import { approveProductRequestAction, rejectProductRequestAction } from "../actions";

/**
 * Approving requires the admin to write a seller-visible summary — it is
 * never auto-derived from the dealer's raw `note` (that would just be a
 * disguised leak). `defaultSummarySeed` is offered only as an editable
 * starting point in the textarea, never submitted verbatim without the
 * admin having looked at it.
 */
export function RequestReviewActions({
  requestId,
  status,
  sellerVisibleSummary,
  adminNotes,
  rejectionReason,
  defaultSummarySeed,
}: {
  requestId: string;
  status: string;
  sellerVisibleSummary: string;
  adminNotes: string;
  rejectionReason: string;
  defaultSummarySeed: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [summary, setSummary] = useState(sellerVisibleSummary || defaultSummarySeed);
  const [notes, setNotes] = useState(adminNotes);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submitApprove() {
    setError(null);
    if (!summary.trim()) {
      setError("Write a seller-visible summary before approving.");
      return;
    }
    startTransition(async () => {
      const result = await approveProductRequestAction(requestId, summary.trim(), notes.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode("idle");
      router.refresh();
    });
  }

  function submitReject() {
    setError(null);
    if (!reason.trim()) {
      setError("Enter a rejection reason.");
      return;
    }
    startTransition(async () => {
      const result = await rejectProductRequestAction(requestId, reason.trim(), notes.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode("idle");
      router.refresh();
    });
  }

  if (status !== "PENDING") {
    return (
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-600">
          Review outcome
        </div>
        {sellerVisibleSummary && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-gray-500">Seller-visible summary</div>
            <p className="mt-1 text-sm leading-relaxed text-ink">{sellerVisibleSummary}</p>
          </div>
        )}
        {rejectionReason && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-gray-500">Rejection reason</div>
            <p className="mt-1 text-sm leading-relaxed text-ink">{rejectionReason}</p>
          </div>
        )}
        {adminNotes && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-gray-500">Internal admin notes</div>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">{adminNotes}</p>
          </div>
        )}
        {!sellerVisibleSummary && !rejectionReason && !adminNotes && (
          <p className="mt-2 text-sm text-gray-500">No review notes recorded.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-gray-600">
        Review this request
      </div>

      {mode === "idle" && (
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="primary" size="sm" onClick={() => setMode("approve")}>
            Approve &amp; forward to seller
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      )}

      {mode === "approve" && (
        <div className="mt-3 flex flex-col gap-3">
          <FormTextarea
            label="Seller-visible summary"
            hint="Sanitized for the seller — never include the dealer's name, business, contact details, or exact address."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            required
          />
          <FormTextarea
            label="Internal admin notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode("idle")}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={submitApprove}
              loading={isPending}
            >
              Approve &amp; forward
            </Button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-3 flex flex-col gap-3">
          <FormTextarea
            label="Rejection reason"
            hint="Shown to the dealer."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
          />
          <FormTextarea
            label="Internal admin notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode("idle")}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={submitReject}
              loading={isPending}
            >
              Reject request
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
