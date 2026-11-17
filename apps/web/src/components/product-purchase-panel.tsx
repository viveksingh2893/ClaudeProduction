"use client";

import { useState } from "react";
import { PriceDisplay, VariantPicker, type PlainVariant } from "@kisan4u/ui";
import {
  computeUnitPrice,
  getInitialSelection,
  isSelectionComplete,
  resolveVariant,
} from "@kisan4u/catalog/variant-compatibility";
import { ProductGallery, type GalleryImage } from "./product-gallery";
import { NotifyRestockButton, type RestockSubscriptionStatus } from "./notify-restock-button";
import { StickyBuyBar, type BuyBarStatus } from "./sticky-buy-bar";

type RestockInfo = { status: RestockSubscriptionStatus; subscriptionId: string | null };

/**
 * Owns the one piece of state the gallery, the in-column price area and
 * the fixed bottom buy bar all need — which variant (if any) is currently
 * resolved. Picking a variant updates the shown image, the inline price
 * and the StickyBuyBar together. Everything presentational (title, seller
 * line, description) is rendered here too rather than split across a
 * Server/Client boundary that would otherwise cut through this shared
 * state. Add to Cart / Buy Now no longer render inline — they live in the
 * StickyBuyBar, always visible at the bottom of the viewport.
 */
export function ProductPurchasePanel({
  productName,
  sellerName,
  shortDescription,
  images,
  productVideoUrl,
  variants,
  defaultVariantId,
  basePrice,
  baseLoyaltyPoints,
  baseStock,
  productId,
  viewerState,
  audience,
  restockByVariantId,
  buyNowEnabled,
}: {
  productName: string;
  sellerName: string | null;
  shortDescription: string;
  images: GalleryImage[];
  /** Falls back to this when the resolved variant has no video of its own. */
  productVideoUrl?: string | null;
  variants: PlainVariant[];
  defaultVariantId: string | null;
  /** Non-variant products price directly off ProductCustomerConfig — shown as-is when there's nothing to select. */
  basePrice: { sellingPrice: string; mrp: string } | null;
  /** Only meaningful when `variants` is empty — ProductCustomerConfig.loyaltyPoints for a non-variant product. No points-earning logic exists yet, so this is always 0 today. */
  baseLoyaltyPoints: number;
  /** Only meaningful when `variants` is empty — the non-variant product's own on-hand stock. */
  baseStock: number;
  productId: string;
  /** A DEALER session is redirected away from this page entirely (see apps/web/src/app/products/[slug]/page.tsx) before it ever reaches here — never a third "dealer viewing customer price" state. */
  viewerState: "GUEST" | "CUSTOMER";
  audience: "CUSTOMER" | "DEALER";
  /** Pre-fetched restock-subscription status for every variant of this product (keyed by variantId, "" for the non-variant/base row) — batched once server-side rather than queried per selection change. Empty for a GUEST viewer. */
  restockByVariantId: Record<string, RestockInfo>;
  /** Site Settings toggle (see apps/web/src/lib/card-context.ts) — the exact same gate the product card already applies to its own Buy Now button. */
  buyNowEnabled: boolean;
}) {
  // Seed with what VariantPicker will resolve to on mount (its own
  // getInitialSelection + a default variant) so the gallery, the in-column
  // price and the sticky bar all show the right thing on first paint — not
  // a "select options" flash until hydration. VariantPicker still drives it
  // after that via onResolvedChange.
  const [resolvedVariant, setResolvedVariant] = useState<PlainVariant | null>(() => {
    if (variants.length === 0) return null;
    const initial = getInitialSelection(variants, defaultVariantId);
    return isSelectionComplete(variants, initial)
      ? (resolveVariant(variants, initial) as PlainVariant | null)
      : null;
  });

  const hasVariants = variants.length > 0;

  // What the fixed bottom bar shows, derived from the current selection.
  let barStatus: BuyBarStatus = "ready";
  let barPrice: string | null = null;
  let barMrp: string | null = null;
  let barVariantId: string | undefined;
  let barMinQty = 1;
  let barMaxQty: number | undefined;

  if (hasVariants) {
    if (!resolvedVariant) {
      barStatus = "incomplete";
    } else {
      barStatus = resolvedVariant.stockQty > 0 ? "ready" : "out-of-stock";
      barPrice = resolvedVariant.sellingPrice;
      barMrp = resolvedVariant.mrp;
      barVariantId = resolvedVariant.id;
      barMinQty = resolvedVariant.minOrderQty;
      barMaxQty = resolvedVariant.stockQty;
    }
  } else if (basePrice) {
    barStatus = baseStock > 0 ? "ready" : "out-of-stock";
    barPrice = basePrice.sellingPrice;
    barMrp = basePrice.mrp;
    barMaxQty = baseStock;
  }

  const showBar = hasVariants || basePrice != null;

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,44%)_1fr] lg:items-start">
        <div className="lg:sticky lg:top-6">
          <ProductGallery
            images={images}
            name={productName}
            variantImages={
              resolvedVariant
                ? [
                    ...(resolvedVariant.imageUrl
                      ? [
                          {
                            id: "variant-cover",
                            url: resolvedVariant.imageUrl,
                            altText: resolvedVariant.imageAlt,
                          },
                        ]
                      : []),
                    ...resolvedVariant.images,
                  ]
                : null
            }
            video={resolvedVariant?.videoUrl ?? null}
            fallbackVideo={productVideoUrl}
          />
        </div>

        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-extrabold leading-tight text-ink sm:text-[28px]">
            {productName}
          </h1>
          {sellerName && (
            <div className="text-[13px] text-gray-600">
              Sold by <span className="font-bold text-green-700">{sellerName}</span>
            </div>
          )}

          {/*
            Only ever one price on the page at a time — spec: a variant
            product shows just the selected variant's price (below, inside
            VariantPicker), never this base price too. `basePrice` itself
            can be non-null even when variants exist, so the
            `variants.length === 0` check is load-bearing here.
          */}
          {basePrice && variants.length === 0 && (
            <>
              <PriceDisplay
                price={basePrice.sellingPrice}
                originalPrice={basePrice.mrp !== basePrice.sellingPrice ? basePrice.mrp : null}
                size="lg"
              />
              {baseLoyaltyPoints > 0 && (
                <p className="text-xs font-semibold text-earth-700">
                  Earn {baseLoyaltyPoints} loyalty point{baseLoyaltyPoints === 1 ? "" : "s"} on this
                  purchase
                </p>
              )}
              {viewerState === "GUEST" && baseStock > 0 && (
                <p className="text-xs text-gray-500">
                  No account needed to start — you&apos;ll verify your mobile number at checkout.
                </p>
              )}
              {baseStock <= 0 && (
                <div className="flex flex-col gap-2">
                  <span className="w-fit rounded-md border border-border px-3 py-2 text-xs font-bold text-gray-400">
                    Out of stock
                  </span>
                  <NotifyRestockButton
                    target={{ kind: "base", productId, audience }}
                    initialStatus={restockByVariantId[""]?.status ?? "NONE"}
                    initialSubscriptionId={restockByVariantId[""]?.subscriptionId ?? null}
                  />
                </div>
              )}
            </>
          )}

          <div
            className="k4u-rich-content text-sm leading-relaxed text-gray-600"
            dangerouslySetInnerHTML={{ __html: shortDescription }}
          />

          {variants.length > 0 && (
            <>
              {variants.some((v) => v.stockQty <= 0) && variants.some((v) => v.stockQty > 0) && (
                <p className="text-xs font-semibold text-warning">Some variants are out of stock</p>
              )}
              <VariantPicker
                variants={variants}
                defaultVariantId={defaultVariantId}
                onResolvedChange={setResolvedVariant}
                renderPurchaseArea={(resolved) => (
                  <div className="flex flex-col gap-3">
                    <PriceDisplay
                      price={resolved.sellingPrice}
                      originalPrice={
                        resolved.mrp !== resolved.sellingPrice ? resolved.mrp : null
                      }
                      size="lg"
                    />
                    {(() => {
                      const unitPrice = computeUnitPrice(
                        resolved.sellingPrice,
                        resolved.attributeValues,
                      );
                      return (
                        unitPrice != null && (
                          <p className="text-xs text-gray-600">
                            ₹{unitPrice.toFixed(2)} per unit
                          </p>
                        )
                      );
                    })()}
                    {!!resolved.loyaltyPoints && resolved.loyaltyPoints > 0 && (
                      <p className="text-xs font-semibold text-earth-700">
                        Earn {resolved.loyaltyPoints} loyalty point
                        {resolved.loyaltyPoints === 1 ? "" : "s"} on this purchase
                      </p>
                    )}
                    {resolved.stockQty <= 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="w-fit rounded-md border border-border px-3 py-2 text-xs font-bold text-gray-400">
                          Out of stock
                        </span>
                        <NotifyRestockButton
                          target={{ kind: "variant", variantId: resolved.id }}
                          initialStatus={restockByVariantId[resolved.id]?.status ?? "NONE"}
                          initialSubscriptionId={
                            restockByVariantId[resolved.id]?.subscriptionId ?? null
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              />
            </>
          )}
        </div>
      </div>

      {showBar && (
        <StickyBuyBar
          productId={productId}
          variantId={barVariantId}
          price={barPrice}
          mrp={barMrp}
          minOrderQty={barMinQty}
          maxQuantity={barMaxQty}
          status={barStatus}
          buyNowEnabled={buyNowEnabled}
        />
      )}
    </>
  );
}
