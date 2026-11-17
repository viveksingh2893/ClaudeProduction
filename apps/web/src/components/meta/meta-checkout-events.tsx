"use client";

import { useEffect, useRef } from "react";
import type { MetaCartSummary } from "@/lib/meta/shared";
import { trackInitiateCheckout, trackPurchase } from "@/lib/meta/track";

/** Fires Meta "InitiateCheckout" once when the checkout page opens (app/checkout/page.tsx). */
export function MetaInitiateCheckout({ cart }: { cart: MetaCartSummary }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackInitiateCheckout(cart);
  }, [cart]);
  return null;
}

/**
 * Fires Meta "Purchase" on the order confirmation page the buyer lands on
 * after placing a COD order or paying online (orders/[groupId]?placed=1).
 * Its event id is fixed per checkout, and it's remembered per browser tab,
 * so reloading the page never reports the sale twice.
 */
export function MetaPurchase({
  checkoutGroupId,
  orderNumber,
  cart,
}: {
  checkoutGroupId: string;
  orderNumber: string;
  cart: MetaCartSummary;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const key = `k4u_meta_purchase_${checkoutGroupId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked — the fixed event id still de-duplicates at Meta */
    }
    trackPurchase(checkoutGroupId, orderNumber, cart);
  }, [checkoutGroupId, orderNumber, cart]);
  return null;
}
