"use client";

import { AlertBox, Button, EmptyState, ProductImage, QuantitySelector } from "@kisan4u/ui";
import type { CartView } from "@kisan4u/orders";

export function CartPanel({
  cart,
  onUpdateQuantity,
  onRemove,
  isMutating,
}: {
  cart: CartView | null;
  onUpdateQuantity: (cartItemId: string, quantity: number) => void;
  onRemove: (cartItemId: string) => void;
  isMutating: boolean;
}) {
  const isEmpty = !cart || cart.sellerGroups.every((g) => g.items.length === 0);

  if (isEmpty) {
    return (
      <EmptyState
        title="Cart is empty"
        description="Add products from the catalogue on the left."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {cart!.hasValidationErrors && (
        <AlertBox tone="danger">
          Some items in this cart are no longer purchasable — remove or fix them before placing the
          order.
        </AlertBox>
      )}

      {cart!.sellerGroups.map((group) => (
        <div key={group.sellerId} className="rounded-lg border border-border">
          <div className="border-b border-border bg-bg-dashboard px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-600">
            Sold by {group.sellerName}
          </div>
          <div className="flex flex-col divide-y divide-border">
            {group.items.map((item) => (
              <div key={item.cartItemId} className="flex gap-3 p-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border">
                  <ProductImage src={item.productImageUrl} alt={item.productName} />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-bold text-ink">{item.productName}</span>
                  {item.variantLabel && (
                    <span className="text-xs text-gray-500">{item.variantLabel}</span>
                  )}
                  {item.validationError ? (
                    <AlertBox tone="danger" className="mt-1">
                      {item.validationError}
                    </AlertBox>
                  ) : (
                    <>
                      <span className="text-xs text-gray-500">
                        ₹{item.currentPrice?.toFixed(2)} each
                      </span>
                      <div className="mt-1 flex items-center justify-between">
                        <QuantitySelector
                          value={item.quantity}
                          min={item.minOrderQty ?? 1}
                          max={item.currentStock ?? undefined}
                          disabled={isMutating}
                          onDecrease={() =>
                            onUpdateQuantity(
                              item.cartItemId,
                              Math.max(item.minOrderQty ?? 1, item.quantity - 1),
                            )
                          }
                          onIncrease={() => onUpdateQuantity(item.cartItemId, item.quantity + 1)}
                        />
                        <span className="text-sm font-bold text-ink">
                          ₹{item.lineSubtotal?.toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(item.cartItemId)}
                  disabled={isMutating}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-border px-3 py-2 text-sm font-semibold text-ink">
            <span>Seller subtotal</span>
            <span>₹{group.subtotal.toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
