"use client";

import { useState, useTransition } from "react";
import type { StockTarget } from "@kisan4u/catalog";
import {
  subscribeToRestockAction,
  cancelRestockSubscriptionAction,
} from "@/app/products/restock-actions";

export type RestockSubscriptionStatus = "NONE" | "ACTIVE" | "FULFILLED";

/**
 * spec §9 "Notify me when stock is available". FULFILLED reads the same
 * as NONE here (offer to subscribe again) — this button only ever renders
 * while the item is currently out of stock, so a FULFILLED status means
 * the earlier alert already fired and the item has since gone out of
 * stock again, exactly the "may subscribe again after a later stock-out"
 * case spec §9 calls for.
 */
export function NotifyRestockButton({
  target,
  initialStatus,
  initialSubscriptionId,
  compact,
}: {
  target: StockTarget;
  initialStatus: RestockSubscriptionStatus;
  initialSubscriptionId: string | null;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<RestockSubscriptionStatus>(initialStatus);
  const [subscriptionId, setSubscriptionId] = useState(initialSubscriptionId);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      if (status === "ACTIVE") {
        if (!subscriptionId) return;
        const result = await cancelRestockSubscriptionAction(subscriptionId);
        if (result.ok) {
          setStatus("NONE");
          setSubscriptionId(null);
        } else {
          setError(result.error);
        }
        return;
      }
      const result = await subscribeToRestockAction(target);
      if (result.ok) {
        setStatus("ACTIVE");
        setSubscriptionId(result.subscriptionId);
      } else {
        setError(result.error);
      }
    });
  }

  const requested = status === "ACTIVE";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-pressed={requested}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-bold transition-colors disabled:opacity-60 ${
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
        } ${
          requested
            ? "border-green-600 bg-green-50 text-green-700 hover:bg-green-100"
            : "border-border text-ink hover:bg-bg-dashboard"
        }`}
      >
        {requested ? "Notification requested" : "Notify me when stock is available"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
