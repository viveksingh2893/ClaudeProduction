"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonSize } from "@kisan4u/ui";
import { addToCartAction } from "@/app/cart/actions";
import { trackAddToCart } from "@/lib/meta/track";

/**
 * Product Card Design Spec: "direct-to-checkout intent." Minimal-risk
 * implementation — reuses addToCartAction unchanged, then redirects to
 * checkout instead of refreshing. KNOWN LIMITATION (documented at
 * completion, not hidden): this takes the customer to checkout for their
 * whole cart, not an isolated single item — a true isolated buy-now would
 * need changes to packages/orders/src/checkout-draft.ts's
 * buildCheckoutDrafts, which always drafts the caller's entire cart. Out
 * of scope for this pass.
 */
export function BuyNowButton({
  productId,
  variantId,
  quantity,
  size = "sm",
}: {
  productId: string;
  variantId?: string | null;
  quantity: number;
  size?: ButtonSize;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      const result = await addToCartAction({
        productId,
        variantId: variantId ?? undefined,
        quantity,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      trackAddToCart(result.meta, quantity);
      router.push("/checkout");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="primary"
        size={size}
        fullWidth
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Please wait…" : "Buy Now"}
      </Button>
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
