"use client";

import { Card, Badge, PriceDisplay, ProductImage } from "@kisan4u/ui";
import type { ProductCardData } from "@kisan4u/catalog";

/**
 * POS's own product card — same square 1:1 image frame / object-contain /
 * consistent height rules as the storefront's shared ProductCard (spec
 * §2's "all product cards must have equal image and content heights"),
 * fed by the exact same adaptCustomerProduct/adaptDealerProduct output so
 * price/availability can never disagree with the website. Rebuilt rather
 * than importing apps/web's ProductCard directly because that component
 * is wired to next/link storefront hrefs and web's own wishlist/cart
 * actions — POS instead opens a detail modal on click (spec §12) and adds
 * to cart from inside it, never directly from the grid.
 */
export function PosProductCard({
  card,
  onClick,
}: {
  card: ProductCardData & { productId: string };
  onClick: () => void;
}) {
  const blocked = card.purchase.kind !== "BUY_AND_CART";

  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="flex h-full flex-col overflow-hidden p-0 transition-shadow hover:shadow-card">
        <div className="relative aspect-square w-full bg-bg-dashboard">
          <ProductImage src={card.imageUrls[0]} alt={card.name} />
          {card.badge && (
            <Badge tone={card.badge.tone} className="absolute left-2 top-2">
              {card.badge.text}
            </Badge>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          {card.brandName && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {card.brandName}
            </span>
          )}
          <span className="line-clamp-2 text-sm font-bold text-ink">{card.name}</span>
          {card.variantLabel && <span className="text-xs text-gray-500">{card.variantLabel}</span>}

          <div className="mt-auto pt-1.5">
            {card.pricing.kind === "CUSTOMER" && (
              <PriceDisplay
                price={card.pricing.sellingPrice}
                originalPrice={
                  card.pricing.mrp !== card.pricing.sellingPrice ? card.pricing.mrp : null
                }
                size="sm"
              />
            )}
            {card.pricing.kind === "DEALER_PRICED" && (
              <>
                <PriceDisplay
                  price={card.pricing.sellingPrice}
                  originalPrice={
                    card.pricing.mrp !== card.pricing.sellingPrice ? card.pricing.mrp : null
                  }
                  size="sm"
                />
                <span className="text-[11px] font-medium text-gray-500">
                  {card.pricing.moqLabel}
                </span>
              </>
            )}
            {card.pricing.kind === "DEALER_UNPRICED" && (
              <span className="text-xs font-semibold text-gray-500">Price not shown</span>
            )}

            {blocked && (
              <div className="mt-1">
                <Badge tone={card.purchase.kind === "REQUEST_SELLER_ONLY" ? "warning" : "neutral"}>
                  {card.purchase.kind === "REQUEST_SELLER_ONLY"
                    ? "Not available in this state"
                    : "Out of stock"}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </Card>
    </button>
  );
}
