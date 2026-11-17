"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, QuantitySelector } from "@kisan4u/ui";
import { addToCartAction } from "@/app/cart/actions";
import { trackAddToCart } from "@/lib/meta/track";

export function AddToCartButton({
  productId,
  variantId,
  compact = false,
  minQuantity = 1,
  noQuantity = false,
  quantity: controlledQuantity,
}: {
  productId: string;
  variantId?: string;
  /** Tight layout for grid cards; full-size layout is used on the product detail page. */
  compact?: boolean;
  /** Dealer MOQ — the stepper starts here and never goes below it (Complete Design/Admin Spec §3.3: "quantity starts at the applicable MOQ"). Defaults to 1 for the customer/customer case. */
  minQuantity?: number;
  /** Hide this button's own quantity stepper — for the fixed bottom bar on the product page, where a separate quantity box feeds the `quantity` prop instead. */
  noQuantity?: boolean;
  /** Controlled quantity — when the parent owns the quantity control (the product page's fixed bar), pass it here and this button adds exactly that many. */
  quantity?: number;
}) {
  const router = useRouter();
  const [ownQuantity, setQuantity] = useState(minQuantity);
  const quantity = controlledQuantity ?? ownQuantity;
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    setAdded(false);
    startTransition(async () => {
      const result = await addToCartAction({ productId, variantId, quantity });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      trackAddToCart(result.meta, quantity);
      setAdded(true);
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className={`flex items-center gap-2 ${compact ? "" : "gap-3"}`}>
        {!noQuantity && (
          <QuantitySelector
            value={quantity}
            onDecrease={() => setQuantity((q) => Math.max(minQuantity, q - 1))}
            onIncrease={() => setQuantity((q) => q + 1)}
            min={minQuantity}
          />
        )}
        <Button
          type="button"
          variant="secondary"
          size={compact ? "sm" : "md"}
          fullWidth
          onClick={handleClick}
          disabled={isPending}
        >
          {isPending ? "Adding…" : added ? "Added ✓" : "Add to Cart"}
        </Button>
      </div>
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
