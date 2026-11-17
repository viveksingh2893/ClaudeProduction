"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markPackedAndReadyForPickupAction,
  markPickedUpAction,
} from "@/app/seller/orders/actions";
import { InlineActionError } from "./inline-action-error";

/**
 * Inline one-click status steps for the /seller/orders table row. Sellers
 * have no generic status override (each real transition needs pickup-point
 * / shipment side-effects), so only the two steps that take no extra input
 * are offered here:
 *  - Transport order at "Seller accepted" -> Mark packed & ready
 *  - Non-RapidShyp shipment at "Pickup scheduled" -> Mark picked up
 * Everything else (accept + dispatch) is the Create Shipment wizard, and
 * IN_TRANSIT onward is admin-only.
 */
export function SellerInlineStatusControl({
  sellerOrderId,
  status,
  deliveryMethod,
  shipmentProvider,
}: {
  sellerOrderId: string;
  status: string;
  deliveryMethod: string;
  shipmentProvider: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canMarkPacked = status === "SELLER_ACCEPTED" && deliveryMethod !== "KISAN4U_COURIER";
  const canMarkPickedUp =
    status === "PICKUP_SCHEDULED" &&
    shipmentProvider !== "RAPIDSHYP" &&
    shipmentProvider !== "DELHIVERY";

  if (!canMarkPacked && !canMarkPickedUp) return null;

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const label = canMarkPacked ? "Mark packed" : "Mark picked up";
  const handler = canMarkPacked
    ? () => run(() => markPackedAndReadyForPickupAction({ sellerOrderId }))
    : () => run(() => markPickedUpAction(sellerOrderId));

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={handler}
        disabled={isPending}
        className="rounded-md border border-green-600 px-2 py-1 text-xs font-bold text-green-700 transition-colors hover:bg-green-50 disabled:opacity-50"
      >
        {isPending ? "…" : label}
      </button>
      {error && <InlineActionError>{error}</InlineActionError>}
    </div>
  );
}
