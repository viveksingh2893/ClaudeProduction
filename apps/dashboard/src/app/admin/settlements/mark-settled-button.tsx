"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@kisan4u/ui";
import { markCycleSettledForSellerAction } from "./actions";

/**
 * Marks one seller's slice of a payout cycle as SETTLED. Disabled until
 * (a) every non-reversed item for that seller in the cycle is eligible — a
 * batch isn't paid piecemeal — AND (b) the cycle's payout date has
 * arrived. When only (b) is missing, `notYetPayableLabel` is the date it
 * becomes payable, shown as a hint (the server enforces the same rule).
 */
export function MarkCycleSettledButton({
  payoutKey,
  sellerId,
  disabled,
  notYetPayableLabel,
}: {
  payoutKey: string;
  sellerId: string;
  disabled: boolean;
  notYetPayableLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await markCycleSettledForSellerAction(payoutKey, sellerId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const lockedForDate = Boolean(notYetPayableLabel);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={disabled || lockedForDate || isPending}
        title={lockedForDate ? `Payable from ${notYetPayableLabel}` : undefined}
      >
        {isPending ? "Marking…" : "Mark paid"}
      </Button>
      {lockedForDate && (
        <span className="text-[11px] text-gray-500">Payable {notYetPayableLabel}</span>
      )}
      {error && <span className="text-[11px] font-medium text-danger">{error}</span>}
    </div>
  );
}
