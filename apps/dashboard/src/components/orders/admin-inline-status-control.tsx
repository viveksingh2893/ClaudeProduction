"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  adminManualStatusUpdateAction,
  confirmOrderAction,
  cancelPendingOrderAction,
  revertOrderToPendingAction,
} from "@/app/admin/orders/actions";
import { InlineActionError } from "./inline-action-error";

/**
 * Inline order-status control for the /admin/orders table row — the same
 * generic transition the order detail page used to expose as its "Move to
 * status" dropdown, plus a Confirm/Cancel dropdown for a still-Pending
 * order, plus a "Revert to pending" dropdown for an order that's confirmed
 * but not yet scheduled (e.g. a logistics issue blocks dispatch — see
 * revertOrderToPendingAction). Cancelling a Pending order needs a reason
 * (cancelPendingOrderAction requires one), so picking "Cancel" reveals a
 * small reason field inline rather than firing immediately like Confirm
 * does. `adminManualStatusUpdateAction` re-checks the transition
 * server-side (@kisan4u/orders' transitionSellerOrder, pickup-point guard
 * included), so an invalid pick just surfaces an error here.
 */
export function AdminInlineStatusControl({
  sellerOrderId,
  nextStatuses,
  canConfirm,
  canRevertToPending,
}: {
  sellerOrderId: string;
  nextStatuses: { value: string; label: string }[];
  canConfirm: boolean;
  canRevertToPending: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [pendingAction, setPendingAction] = useState<"" | "CONFIRM" | "CANCEL">("");
  const [cancelReason, setCancelReason] = useState("");
  const [revertPicked, setRevertPicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply(value: string) {
    if (!value) return;
    setError(null);
    startTransition(async () => {
      const result = await adminManualStatusUpdateAction({ sellerOrderId, targetStatus: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTarget("");
      router.refresh();
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmOrderAction(sellerOrderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function cancelPending() {
    setError(null);
    startTransition(async () => {
      const result = await cancelPendingOrderAction(sellerOrderId, cancelReason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingAction("");
      setCancelReason("");
      router.refresh();
    });
  }

  function revertToPending() {
    setError(null);
    startTransition(async () => {
      const result = await revertOrderToPendingAction(sellerOrderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRevertPicked(false);
      router.refresh();
    });
  }

  if (canConfirm) {
    return (
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-1">
          <select
            aria-label="Order action"
            value={pendingAction}
            disabled={isPending}
            onChange={(e) => {
              const value = e.target.value as "" | "CONFIRM" | "CANCEL";
              setPendingAction(value);
              setError(null);
              if (value === "CONFIRM") confirm();
            }}
            className="max-w-[130px] rounded-md border border-green-600 bg-surface px-1.5 py-1 text-xs font-bold text-green-700"
          >
            <option value="">Choose action…</option>
            <option value="CONFIRM">Confirm</option>
            <option value="CANCEL">Cancel</option>
          </select>
          {isPending && <span className="text-xs text-gray-400">…</span>}
        </div>
        {pendingAction === "CANCEL" && (
          <div className="mt-1 flex flex-col gap-1">
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancelling"
              disabled={isPending}
              className="w-[150px] rounded-md border border-border px-1.5 py-1 text-xs text-ink"
            />
            <button
              type="button"
              disabled={isPending || cancelReason.trim().length < 3}
              onClick={cancelPending}
              className="rounded-md border border-danger px-2 py-1 text-xs font-bold text-danger transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              {isPending ? "…" : "Cancel order"}
            </button>
          </div>
        )}
        {error && <InlineActionError>{error}</InlineActionError>}
      </div>
    );
  }

  if (canRevertToPending) {
    return (
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-1">
          <select
            aria-label="Order action"
            value={revertPicked ? "REVERT" : ""}
            disabled={isPending}
            onChange={(e) => {
              if (e.target.value === "REVERT") {
                setRevertPicked(true);
                revertToPending();
              }
            }}
            className="max-w-[150px] rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-ink"
          >
            <option value="">Order actions…</option>
            <option value="REVERT">Revert to pending</option>
          </select>
          {isPending && <span className="text-xs text-gray-400">…</span>}
        </div>
        {error && <InlineActionError>{error}</InlineActionError>}
      </div>
    );
  }

  if (nextStatuses.length === 0) return null;

  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-1">
        <select
          aria-label="Change order status"
          value={target}
          disabled={isPending}
          onChange={(e) => setTarget(e.target.value)}
          className="max-w-[130px] rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-ink"
        >
          <option value="">Change status…</option>
          {nextStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Apply status change"
          disabled={isPending || !target}
          onClick={() => apply(target)}
          className="inline-flex items-center rounded-md p-1 text-gray-500 transition-colors hover:bg-green-50 hover:text-green-700 disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {error && <InlineActionError>{error}</InlineActionError>}
    </div>
  );
}
