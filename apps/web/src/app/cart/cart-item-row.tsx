"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CartLineView } from "@kisan4u/orders";
import { AlertBox, QuantitySelector, ProductImage } from "@kisan4u/ui";
import { updateCartItemQuantityAction, removeCartItemAction } from "./actions";

export function CartItemRow({ item }: { item: CartLineView }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(item.quantity);
  const [error, setError] = useState<string | null>(item.validationError);
  const [isPending, startTransition] = useTransition();

  function updateQuantity(next: number) {
    if (next < 1) return;
    setQuantity(next);
    startTransition(async () => {
      const result = await updateCartItemQuantityAction({
        cartItemId: item.cartItemId,
        quantity: next,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await removeCartItemAction(item.cartItemId);
      router.refresh();
    });
  }

  return (
    <div
      className={`flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 ${item.validationError ? "opacity-60" : ""}`}
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-green-50">
        <ProductImage src={item.productImageUrl} alt={item.productName} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink">{item.productName}</div>
        {item.variantLabel && <div className="text-xs text-gray-600">{item.variantLabel}</div>}
        <div className="text-xs text-gray-600">SKU {item.sku}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
          {item.unitWeightGrams != null && (
            <span>
              {item.unitWeightGrams} g each · {item.totalWeightGrams} g total
            </span>
          )}
          {item.minOrderQty != null && item.minOrderQty > 1 && (
            <span>Minimum order: {item.minOrderQty}</span>
          )}
          {item.currentStock != null && (
            <span className={item.currentStock > 0 ? "" : "font-semibold text-danger"}>
              {item.currentStock > 0 ? `${item.currentStock} in stock` : "Out of stock"}
            </span>
          )}
        </div>
        {item.priceChanged && (
          <div className="mt-1 text-xs font-medium text-warning">
            Price changed since you added this item — now ₹{item.currentPrice?.toFixed(2)} (was ₹
            {item.priceAtAdd.toFixed(2)})
          </div>
        )}
        {error && (
          <div className="mt-1.5 max-w-sm">
            <AlertBox tone="danger">{error}</AlertBox>
            {error === item.validationError &&
              (item.validationErrorCode === "STATE_UNAVAILABLE" ||
                item.validationErrorCode === "LICENSE_MISSING") && (
              <p className="mt-1 text-xs text-gray-600">
                This depends on your delivery address's state, not your account's selected state.
                Choose a different delivery address, or contact support if you believe this is
                incorrect.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <QuantitySelector
          value={quantity}
          onDecrease={() => updateQuantity(quantity - 1)}
          onIncrease={() => updateQuantity(quantity + 1)}
          disabled={isPending}
        />
        <div className="min-w-[80px] text-right text-sm font-bold text-ink">
          {item.lineSubtotal != null ? `₹${item.lineSubtotal.toFixed(2)}` : "—"}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={isPending}
          className="text-xs font-bold text-danger hover:underline disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
