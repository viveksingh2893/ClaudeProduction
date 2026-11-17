import { useRef, useState } from "react";
import { router } from "expo-router";
import { addToCart as addToCartApi } from "@/lib/api/cart";
import { useCart } from "@/context/cart-context";
import type { ApiResult } from "@/lib/api-client";

type PurchaseInput = { productId: string; variantId?: string; quantity: number };

/**
 * Shared Add to Cart / Buy Now action pair for product cards and detail
 * screens. Mirrors web's buy-now-button.tsx exactly: Buy Now is
 * add-to-cart-then-navigate-to-the-existing-checkout-screen, reusing the
 * same POST /api/mobile/v1/cart + @kisan4u/orders addToCart everything
 * else already calls — not a separate/duplicate order system. Known
 * limitation carried over from web: this takes the shopper to checkout
 * for their whole cart, not an isolated single item (an isolated buy-now
 * would require changing buildCheckoutDrafts, which always drafts the
 * caller's entire cart).
 *
 * `inFlight` is a ref (not just the `busy` state) so a second tap that
 * lands before the first render flush still gets ignored — guards against
 * duplicate cart lines / duplicate checkout navigation from a double-tap.
 */
export function usePurchaseActions() {
  const [busy, setBusy] = useState<"cart" | "buyNow" | null>(null);
  const inFlight = useRef(false);
  const { refresh: refreshCartCount } = useCart();

  async function addToCart(input: PurchaseInput): Promise<ApiResult<{ cartItemId: string }>> {
    if (inFlight.current)
      return {
        ok: false,
        error: {
          code: "DUPLICATE_SUBMIT",
          message: "Please wait, still processing your last action.",
        },
      };
    inFlight.current = true;
    setBusy("cart");
    try {
      const result = await addToCartApi(input);
      if (result.ok) void refreshCartCount();
      return result;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function buyNow(input: PurchaseInput): Promise<ApiResult<{ cartItemId: string }>> {
    if (inFlight.current)
      return {
        ok: false,
        error: {
          code: "DUPLICATE_SUBMIT",
          message: "Please wait, still processing your last action.",
        },
      };
    inFlight.current = true;
    setBusy("buyNow");
    try {
      const result = await addToCartApi(input);
      if (result.ok) {
        void refreshCartCount();
        router.push("/(app)/checkout");
      }
      return result;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return { busy, addToCart, buyNow };
}
