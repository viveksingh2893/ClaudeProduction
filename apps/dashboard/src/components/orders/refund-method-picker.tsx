"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RefundChoice } from "@kisan4u/orders";
import { formatCurrency } from "@kisan4u/ui";
import { completeRefundAction } from "@/app/admin/orders/actions";
import { InlineActionError } from "./inline-action-error";

/**
 * Refund dropdown for a cancelled / returned / RTO'd order whose refund is
 * approved and waiting on the admin — on the /admin/orders and
 * /admin/order-scheduling table rows and the order detail page. `choices`
 * comes from @kisan4u/orders' refundChoicesFor (POS: manual or wallet;
 * buyer already chose: just that; nobody chose: wallet or Razorpay), and
 * completeRefund re-checks the pick server-side.
 */
export function RefundMethodPicker({
  sellerOrderId,
  refundRequestId,
  kind,
  amount,
  choices,
  compact = false,
}: {
  sellerOrderId: string;
  refundRequestId: string;
  kind: "Cancellation" | "Return" | "RTO";
  amount: string;
  choices: RefundChoice[];
  /** Table-row sizing. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState(choices.length === 1 ? choices[0]!.method : "");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const picked = choices.find((c) => c.method === method);
  const canSubmit = !!picked && (!picked.needsReference || reference.trim().length > 0);

  function submit() {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const result = await completeRefundAction(
        {
          refundRequestId,
          externalReference: reference.trim() || undefined,
          overrideRefundMethod: picked.method,
        },
        sellerOrderId,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const inputWidth = compact ? "w-[150px]" : "w-full max-w-xs";

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-[11px] font-semibold text-amber-700">
        {kind} refund · {formatCurrency(amount)}
      </span>
      <select
        aria-label={`${kind} refund method`}
        value={method}
        disabled={isPending}
        onChange={(e) => {
          setMethod(e.target.value);
          setError(null);
        }}
        className={`${inputWidth} rounded-md border border-amber-500 bg-surface px-1.5 py-1 text-xs font-bold text-ink`}
      >
        {choices.length > 1 && <option value="">Choose refund method…</option>}
        {choices.map((c) => (
          <option key={c.method} value={c.method}>
            {c.label}
          </option>
        ))}
      </select>
      {picked?.needsReference && (
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Reference (UPI / bank txn id)"
          disabled={isPending}
          className={`${inputWidth} rounded-md border border-border px-1.5 py-1 text-xs text-ink`}
        />
      )}
      <button
        type="button"
        disabled={isPending || !canSubmit}
        onClick={submit}
        className="rounded-md border border-green-600 px-2 py-1 text-xs font-bold text-green-700 transition-colors hover:bg-green-50 disabled:opacity-40"
      >
        {isPending ? "…" : "Refund"}
      </button>
      {error && <InlineActionError>{error}</InlineActionError>}
    </div>
  );
}
