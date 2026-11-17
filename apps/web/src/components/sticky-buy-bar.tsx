"use client";

import { useState } from "react";
import { formatCurrency, LinkButton } from "@kisan4u/ui";
import { AddToCartButton } from "./add-to-cart-button";
import { BuyNowButton } from "./buy-now-button";
import { QuantityInput } from "./quantity-input";

export type BuyBarStatus =
  | "ready"
  | "incomplete"
  | "out-of-stock"
  // Dealer-only: not available in this dealer's state / no covering
  // licence — no price, no cart action, the bar offers "Request This
  // Product" instead (see dealer-purchase-panel.tsx).
  | "state-unavailable"
  // Dealer-only: any other blocking reason (inactive/unapproved product
  // or seller, missing config) — `message` carries the specific reason,
  // no action at all.
  | "unavailable";

/**
 * The always-visible Flipkart-style purchase bar pinned to the bottom of
 * the viewport on the product page (mobile and desktop) — shared as-is by
 * both the customer and dealer product pages so the two look identical;
 * only the price/eligibility data and `status` fed in differ. Mirrors the
 * current variant selection lifted up from ProductPurchasePanel /
 * DealerPurchasePanel.
 *
 * Layout is built to fit ANY width: on a phone it's just the two buttons
 * (or the one "Request This Product" button) side by side, each
 * `flex-1 min-w-0` so they shrink to fit and never overflow; the price and
 * per-unit line only appear from `sm:` up where there's room. A compact
 * quantity box (type a number or use − / +) sits before the buttons and
 * feeds both Buy Now and Add to Cart; it starts at the minimum order
 * quantity and resets whenever the selected variant changes.
 */
export function StickyBuyBar({
  productId,
  variantId,
  price,
  mrp,
  minOrderQty,
  status,
  buyNowEnabled,
  message,
  requestHref,
  maxQuantity,
}: {
  productId: string;
  variantId?: string;
  price: string | null;
  mrp: string | null;
  minOrderQty: number;
  status: BuyBarStatus;
  buyNowEnabled: boolean;
  /** Custom reason shown for `status === "unavailable"`. */
  message?: string;
  /** "Request This Product" target for `status === "state-unavailable"`. */
  requestHref?: string;
  /** Optional cap for the quantity box (e.g. the selected variant's stock). */
  maxQuantity?: number;
}) {
  // Quantity resets to the minimum order quantity whenever the selection
  // (variant / MOQ) changes — derived from a key during render rather than
  // synced in an effect, so there's never a frame showing a stale quantity.
  const resetKey = `${variantId ?? ""}:${minOrderQty}`;
  const [qtyState, setQtyState] = useState({ key: resetKey, qty: minOrderQty });
  const quantity = qtyState.key === resetKey ? qtyState.qty : minOrderQty;
  const setQuantity = (qty: number) => setQtyState({ key: resetKey, qty });

  const showStrike = price != null && mrp != null && mrp !== price;
  const savedAmount = showStrike ? Number(mrp) - Number(price) : 0;
  const showSaved = showStrike && Number.isFinite(savedAmount) && savedAmount > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
      {price != null && (
        <div className="mx-auto flex w-full max-w-[1300px] items-center justify-between gap-2 border-b border-border/60 px-3 pt-1.5 sm:px-6 lg:px-8">
          <div className="flex shrink-0 flex-col leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-extrabold text-ink">{formatCurrency(price)}</span>
              {showStrike && (
                <span className="text-xs text-gray-400 line-through">{formatCurrency(mrp)}</span>
              )}
            </div>
            {status === "out-of-stock" && (
              <span className="text-[11px] font-semibold text-danger">Out of stock</span>
            )}
          </div>
          {showSaved && (
            <span className="shrink-0 rounded-full bg-green-600 px-2.5 py-1 text-[11px] font-bold text-white">
              Saved {formatCurrency(savedAmount)}
            </span>
          )}
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[1300px] items-center gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-2.5 lg:px-8">
        {status === "incomplete" ? (
          <p className="flex-1 truncate text-center text-xs font-medium text-gray-500">
            Select options above to add to cart
          </p>
        ) : status === "out-of-stock" ? (
          <p className="flex-1 truncate text-center text-xs font-medium text-gray-500">
            Currently unavailable — see &ldquo;Notify me&rdquo; above
          </p>
        ) : status === "unavailable" ? (
          <p className="flex-1 truncate text-center text-xs font-medium text-gray-500">
            {message ?? "This option isn't available for purchase."}
          </p>
        ) : status === "state-unavailable" ? (
          <div className="flex flex-1 items-center justify-end">
            <div className="min-w-0 flex-1 sm:max-w-[240px]">
              {requestHref ? (
                <LinkButton href={requestHref} variant="primary" size="md" fullWidth>
                  Request This Product
                </LinkButton>
              ) : (
                <p className="truncate text-center text-xs font-medium text-gray-500">
                  Not currently available in your state
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2 sm:justify-end">
            <QuantityInput
              value={quantity}
              onChange={setQuantity}
              min={minOrderQty}
              max={maxQuantity}
            />
            {buyNowEnabled && (
              <div className="min-w-0 flex-1 sm:max-w-[180px]">
                <BuyNowButton
                  productId={productId}
                  variantId={variantId ?? null}
                  quantity={quantity}
                  size="md"
                />
              </div>
            )}
            <div className="min-w-0 flex-1 sm:max-w-[200px]">
              <AddToCartButton
                productId={productId}
                variantId={variantId}
                minQuantity={minOrderQty}
                quantity={quantity}
                compact
                noQuantity
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
