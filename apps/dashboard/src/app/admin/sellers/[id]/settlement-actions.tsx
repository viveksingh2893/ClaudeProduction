"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FormSelect, FormTextarea, Modal } from "@kisan4u/ui";
import type { SettlementAdjustmentReason } from "@kisan4u/db";
import { SETTLEMENT_ADJUSTMENT_REASON_LABEL } from "@/lib/settlement-status-labels";
import { markSettlementsSettledAction, reverseSettlementAction } from "./actions";

const REASONS: SettlementAdjustmentReason[] = [
  "RETURN",
  "REFUND",
  "CANCELLATION",
  "RTO",
  "CHARGEBACK",
  "MANUAL_CORRECTION",
];

/**
 * Admin-only row actions for one settlement — financial records are
 * read-only from ordinary UI forms, so both actions here go through a
 * server-authorized, audited action (see ../actions.ts). "Mark settled" is
 * the only path to SETTLED (no automatic payout integration exists yet);
 * "Reverse / adjust" always creates an append-only SettlementAdjustment,
 * never edits the original row.
 */
export function SettlementRowActions({
  settlementId,
  status,
}: {
  settlementId: string;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState<SettlementAdjustmentReason>("RETURN");
  const [note, setNote] = useState("");
  const [fullReversal, setFullReversal] = useState(true);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleMarkSettled() {
    startTransition(async () => {
      const result = await markSettlementsSettledAction([settlementId]);
      if (result.ok) router.refresh();
    });
  }

  function handleReverse() {
    setError(null);
    if (!note.trim()) {
      setError("A note is required for an adjustment.");
      return;
    }
    const signedAmount = fullReversal ? undefined : -Math.abs(Number(amount));
    if (!fullReversal && (!Number.isFinite(signedAmount) || signedAmount === 0)) {
      setError("Enter a valid adjustment amount.");
      return;
    }
    startTransition(async () => {
      const result = await reverseSettlementAction(settlementId, reason, note, signedAmount);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReversing(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {status === "ELIGIBLE" && (
        <Button size="sm" variant="outline" onClick={handleMarkSettled} loading={isPending}>
          Mark settled
        </Button>
      )}
      {status !== "REVERSED" && (
        <Button size="sm" variant="ghost" onClick={() => setReversing(true)}>
          Reverse / adjust
        </Button>
      )}

      <Modal
        open={reversing}
        onClose={() => setReversing(false)}
        title="Reverse or adjust this settlement"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-600">
            This never edits the original calculation — it creates an auditable adjustment record
            and updates the settlement&apos;s net payable.
          </p>
          <FormSelect
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as SettlementAdjustmentReason)}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {SETTLEMENT_ADJUSTMENT_REASON_LABEL[r]}
              </option>
            ))}
          </FormSelect>
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={fullReversal} onChange={() => setFullReversal(true)} />
              Full reversal (zero out the current payable)
            </label>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!fullReversal} onChange={() => setFullReversal(false)} />
              Partial adjustment
            </label>
          </div>
          {!fullReversal && (
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount to deduct (₹)"
              className="w-full rounded-md border-[1.5px] border-border px-3 py-2.5 text-sm text-ink outline-none focus:border-green-600"
            />
          )}
          <FormTextarea
            label="Note (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            required
          />
          {error && (
            <span role="alert" className="text-xs font-medium text-danger">
              {error}
            </span>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReversing(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReverse} loading={isPending}>
              Confirm adjustment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
