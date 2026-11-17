"use client";

import { useState, type ReactNode } from "react";
import { AlertBox, PriceDisplay, VariantPicker, type PlainVariant } from "@kisan4u/ui";
import {
  computeUnitPrice,
  getInitialSelection,
  isSelectionComplete,
  resolveVariant,
} from "@kisan4u/catalog/variant-compatibility";
import type { LineValidationErrorCode } from "@kisan4u/orders";
import { ProductGallery, type GalleryImage } from "./product-gallery";
import { NotifyRestockButton, type RestockSubscriptionStatus } from "./notify-restock-button";
import { StickyBuyBar, type BuyBarStatus } from "./sticky-buy-bar";

type RestockInfo = { status: RestockSubscriptionStatus; subscriptionId: string | null };

export type DealerLineEligibility =
  { ok: true } | { ok: false; error: string; code: LineValidationErrorCode };

type PriceInfo = {
  sellingPrice: number;
  mrp: number;
  minOrderQty: number;
  unitPrice: number | null;
  loyaltyPoints: number;
};

type BarState = {
  status: BuyBarStatus;
  price: string | null;
  mrp: string | null;
  minOrderQty: number;
  message?: string;
  requestHref?: string;
};

const INCOMPLETE_BAR: BarState = { status: "incomplete", price: null, mrp: null, minOrderQty: 1 };

/**
 * Dealer-page sibling of ProductPurchasePanel (apps/web/src/components/
 * product-purchase-panel.tsx) — identical visual shell (wide sticky
 * gallery, heading, attribute-button VariantPicker, fixed bottom
 * StickyBuyBar) so the two pages look the same. Every purchase decision
 * (price, Add to Cart vs. "not available in your state" + Request This
 * Product vs. a specific blocking reason) is dealer eligibility, computed
 * server-side via validateCartLine and passed in — never re-derived or
 * trusted client-side. `variantEligibility` is a plain `{ [variantId]:
 * result }` object (not a Map — Maps don't cross the Server -> Client
 * prop boundary), one entry per product.variants, already computed by the
 * page for every variant up front.
 *
 * The bar's state is computed directly from `resolvedVariant` (this
 * component's own lifted state), not from inside VariantPicker's
 * `renderPurchaseArea` — that callback runs during VariantPicker's own,
 * later render pass, so a value it produced wouldn't be visible yet to
 * this component's own JSX in the same pass. `resolveDealerLine` is a
 * pure function of eligibility/price, so calling it once here (for the
 * bar) and again inside renderPurchaseArea (for the inline display) is
 * cheap and always agrees.
 */
export function DealerPurchasePanel({
  productId,
  productName,
  sellerName,
  shortDescription,
  images,
  productVideoUrl,
  variants,
  defaultVariantId,
  baseEligibility,
  baseConfig,
  variantEligibility,
  restockByVariantId,
  buyNowEnabled,
}: {
  productId: string;
  productName: string;
  sellerName: string | null;
  shortDescription: string;
  images: GalleryImage[];
  /** Falls back to this when the resolved variant has no video of its own. */
  productVideoUrl?: string | null;
  variants: PlainVariant[];
  defaultVariantId: string | null;
  /** Only meaningful when `variants` is empty — eligibility for the base (non-variant) product. */
  baseEligibility: DealerLineEligibility | null;
  baseConfig: { minOrderQty: number; mrp: number; sellingPrice: number; loyaltyPoints: number } | null;
  variantEligibility: Record<string, DealerLineEligibility>;
  /** Pre-fetched restock-subscription status for every variant of this product (keyed by variantId, "" for the non-variant/base row) — see ProductPurchasePanel's identical prop. */
  restockByVariantId: Record<string, RestockInfo>;
  /** Site Settings toggle (see apps/web/src/lib/card-context.ts) — the exact same gate the customer page's Buy Now button uses. */
  buyNowEnabled: boolean;
}) {
  // Seed with what VariantPicker will resolve to on mount, same as
  // ProductPurchasePanel — the gallery and the bar show the right thing on
  // first paint instead of an "incomplete" flash until hydration.
  const [resolvedVariant, setResolvedVariant] = useState<PlainVariant | null>(() => {
    if (variants.length === 0) return null;
    const initial = getInitialSelection(variants, defaultVariantId);
    return isSelectionComplete(variants, initial)
      ? (resolveVariant(variants, initial) as PlainVariant | null)
      : null;
  });

  const hasVariants = variants.length > 0;

  let bar: BarState = INCOMPLETE_BAR;
  let baseDisplay: ReactNode = null;

  if (!hasVariants) {
    const priceInfo: PriceInfo | null = baseConfig ? { ...baseConfig, unitPrice: null } : null;
    const resolved = resolveDealerLine(
      baseEligibility,
      priceInfo,
      productId,
      undefined,
      restockByVariantId[""] ?? null,
    );
    baseDisplay = resolved.display;
    bar = resolved.bar;
  } else if (resolvedVariant) {
    bar = resolveDealerLine(
      variantEligibility[resolvedVariant.id] ?? null,
      {
        sellingPrice: Number(resolvedVariant.sellingPrice),
        mrp: Number(resolvedVariant.mrp),
        minOrderQty: resolvedVariant.minOrderQty,
        unitPrice: computeUnitPrice(resolvedVariant.sellingPrice, resolvedVariant.attributeValues),
        loyaltyPoints: resolvedVariant.loyaltyPoints ?? 0,
      },
      productId,
      resolvedVariant.id,
      restockByVariantId[resolvedVariant.id] ?? null,
    ).bar;
  }

  const showBar = hasVariants || baseConfig != null || baseEligibility != null;

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

          <div
            className="k4u-rich-content text-sm leading-relaxed text-gray-600"
            dangerouslySetInnerHTML={{ __html: shortDescription }}
          />

          {!hasVariants && baseDisplay}

          {hasVariants && (
            <>
              {variants.some((v) => variantEligibility[v.id]?.ok === false) &&
                variants.some((v) => variantEligibility[v.id]?.ok === true) && (
                  <p className="text-xs font-semibold text-warning">Some variants are out of stock</p>
                )}
              <VariantPicker
                variants={variants}
                defaultVariantId={defaultVariantId}
                onResolvedChange={setResolvedVariant}
                incompleteHint="Select the options above to see price and availability."
                renderPurchaseArea={(resolved) =>
                  resolveDealerLine(
                    variantEligibility[resolved.id] ?? null,
                    {
                      sellingPrice: Number(resolved.sellingPrice),
                      mrp: Number(resolved.mrp),
                      minOrderQty: resolved.minOrderQty,
                      unitPrice: computeUnitPrice(resolved.sellingPrice, resolved.attributeValues),
                      loyaltyPoints: resolved.loyaltyPoints ?? 0,
                    },
                    productId,
                    resolved.id,
                    restockByVariantId[resolved.id] ?? null,
                  ).display
                }
              />
            </>
          )}
        </div>
      </div>

      {showBar && (
        <StickyBuyBar
          productId={productId}
          variantId={hasVariants ? resolvedVariant?.id : undefined}
          price={bar.price}
          mrp={bar.mrp}
          minOrderQty={bar.minOrderQty}
          status={bar.status}
          buyNowEnabled={buyNowEnabled}
          message={bar.message}
          requestHref={bar.requestHref}
        />
      )}
    </>
  );
}

/**
 * The single place dealer eligibility turns into both (a) what shows
 * inline in the column — price/MOQ/loyalty display, a "not available in
 * your state" notice, an out-of-stock notice + Notify me, or the specific
 * blocking reason — and (b) the fixed bottom bar's state, so the two can
 * never say something different about the same line.
 */
function resolveDealerLine(
  eligibility: DealerLineEligibility | null,
  price: PriceInfo | null,
  productId: string,
  variantId: string | undefined,
  restockInfo: RestockInfo | null,
): { display: ReactNode; bar: BarState } {
  if (!eligibility) {
    return {
      display: (
        <p className="text-sm text-gray-600">This option is not configured for dealer purchase yet.</p>
      ),
      bar: {
        status: "unavailable",
        price: null,
        mrp: null,
        minOrderQty: 1,
        message: "Not configured for dealer purchase yet.",
      },
    };
  }

  if (eligibility.ok && price) {
    return {
      display: (
        <div className="flex flex-col gap-3">
          <PriceDisplay
            price={price.sellingPrice.toFixed(2)}
            originalPrice={price.mrp > price.sellingPrice ? price.mrp.toFixed(2) : null}
            size="lg"
          />
          {price.unitPrice != null && (
            <p className="text-xs text-gray-600">₹{price.unitPrice.toFixed(2)} per unit</p>
          )}
          {price.loyaltyPoints > 0 && (
            <p className="text-xs font-semibold text-earth-700">
              Earn {price.loyaltyPoints} loyalty point{price.loyaltyPoints === 1 ? "" : "s"} on this
              purchase
            </p>
          )}
          <div className="text-xs text-gray-600">
            Minimum dealer quantity: <span className="font-semibold text-ink">{price.minOrderQty}</span>
          </div>
        </div>
      ),
      bar: {
        status: "ready",
        price: price.sellingPrice.toFixed(2),
        mrp: price.mrp.toFixed(2),
        minOrderQty: price.minOrderQty,
      },
    };
  }

  if (eligibility.ok) {
    // Eligible but no price info handed in — shouldn't happen in practice
    // (the page only builds PriceInfo when it has dealerConfig/a variant),
    // kept as a safe fallback rather than a crash.
    return {
      display: <p className="text-sm text-gray-600">This option is not configured for dealer purchase yet.</p>,
      bar: { status: "unavailable", price: null, mrp: null, minOrderQty: 1 },
    };
  }

  // Selling-licence module spec §12: a missing/pending/rejected/expired/
  // revoked licence, or a state-wise-approved licence that just doesn't
  // cover this dealer's state, gets the exact same "unavailable here, no
  // price, Request This Product" treatment as a plain non-licence state
  // restriction — the dealer is never told WHY in licensing terms (that
  // would leak seller compliance detail), only that it isn't available.
  if (eligibility.code === "STATE_UNAVAILABLE" || eligibility.code === "LICENSE_MISSING") {
    return {
      display: <AlertBox tone="warning">Not currently available in your state.</AlertBox>,
      bar: {
        status: "state-unavailable",
        price: null,
        mrp: null,
        minOrderQty: 1,
        requestHref: `/dealer/requests/new?productId=${productId}${variantId ? `&variantId=${variantId}` : ""}`,
      },
    };
  }

  // spec §9's explicit dealer carve-out: out of stock is never treated as
  // a licensing/state block (no Request This Product), and it's the one
  // reason that gets a purchase-adjacent action of its own — the same
  // restock alert a customer gets, since the product is otherwise legally
  // available to this dealer.
  if (eligibility.code === "OUT_OF_STOCK") {
    return {
      display: (
        <div className="flex flex-col gap-2">
          <AlertBox tone="danger">Out of stock</AlertBox>
          <NotifyRestockButton
            target={
              variantId ? { kind: "variant", variantId } : { kind: "base", productId, audience: "DEALER" }
            }
            initialStatus={restockInfo?.status ?? "NONE"}
            initialSubscriptionId={restockInfo?.subscriptionId ?? null}
          />
        </div>
      ),
      bar: {
        status: "out-of-stock",
        price: price ? price.sellingPrice.toFixed(2) : null,
        mrp: price ? price.mrp.toFixed(2) : null,
        minOrderQty: price?.minOrderQty ?? 1,
      },
    };
  }

  // Every other reason (inactive/unapproved product or seller, missing
  // config) — show the specific reason, never Request This Product and
  // never purchase controls.
  return {
    display: <AlertBox tone="danger">{eligibility.error}</AlertBox>,
    bar: { status: "unavailable", price: null, mrp: null, minOrderQty: 1, message: eligibility.error },
  };
}
