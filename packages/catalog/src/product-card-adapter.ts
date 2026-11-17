import type { DbLanguage } from "@kisan4u/validators";
import type { getCustomerCatalogue, getDealerCatalogue } from "./queries";
import type { HomepageProduct } from "./homepage";
import { resolveCardBadge, type BadgeTone } from "./badge-resolution";
import { resolveProductName } from "./product-content";
import { computeUnitPrice } from "./variant-compatibility";

/** Options every card adapter takes. `language` (default EN) localizes the display name. */
export type CardAdapterOpts = {
  ratingThreshold: number;
  wishlisted: boolean;
  language?: DbLanguage;
};

/**
 * Product Card Design Spec: one unified ProductCard component covers both
 * customer and dealer views, fed by two pure adapter functions here (one
 * per audience) rather than converging the underlying Prisma queries —
 * the dealer query's price-inclusion is itself audience/eligibility-gated
 * (see packages/catalog/src/queries.ts's DEALER_CATALOGUE_SELECT doc
 * comment), so keeping the queries separate preserves that as a real
 * server-side data-shape guarantee, not just a UI convention.
 */

type CustomerProduct = Awaited<ReturnType<typeof getCustomerCatalogue>>[number];
type DealerProduct = Awaited<ReturnType<typeof getDealerCatalogue>>[number];

export type ProductCardPricing =
  | {
      kind: "CUSTOMER";
      mrp: number;
      sellingPrice: number;
      discountText: string | null;
      /** Lowest per-unit price across the product's active variants (`perUnitMrp` where a variant is a multi-piece case, else that variant's own price) — matches the product page's "₹X per unit". */
      minUnitPrice: number;
    }
  | {
      kind: "DEALER_PRICED";
      mrp: number;
      sellingPrice: number;
      moqLabel: string;
      minUnitPrice: number;
    }
  | { kind: "DEALER_UNPRICED"; moqLabel: string | null };

export type ProductCardPurchase =
  | { kind: "BUY_AND_CART"; productId: string; variantId: string | null; minOrderQty: number }
  | { kind: "REQUEST_SELLER_ONLY"; requestHref: string }
  // spec §8/§9 — the product/variant is otherwise eligible (approved,
  // published, in-audience, in-state/licensed where applicable) but the
  // resolved variant/base config is out of stock. Distinct from NONE
  // (kept only for a hypothetical future non-stock block) so the UI knows
  // to render the "Notify me when stock is available" action here instead
  // of a bare, dead "Out of Stock" pill.
  | {
      kind: "OUT_OF_STOCK_NOTIFY";
      productId: string;
      variantId: string | null;
      audience: "CUSTOMER" | "DEALER";
    }
  | { kind: "NONE" };

export type ProductCardRating = { average: number; count: number } | "NEW" | null;

/** null = every variant (or the single non-variant config) is in stock. Set only when there IS at least one out-of-stock unit to report — SOME_VARIANTS_OUT_OF_STOCK never applies to a non-variant product (there's only ever one stock figure), and OUT_OF_STOCK_ALL is redundant with purchase.kind === "OUT_OF_STOCK_NOTIFY" but kept as an explicit signal for card copy. */
export type StockMessage = "SOME_VARIANTS_OUT_OF_STOCK" | null;

export type ProductCardData = {
  id: string;
  href: string;
  imageUrls: string[];
  brandName: string | null;
  name: string;
  subtitle: string | null;
  audience: "CUSTOMER" | "DEALER";
  variantLabel: string | null;
  badge: { text: string; tone: BadgeTone } | null;
  rating: ProductCardRating;
  pricing: ProductCardPricing;
  purchase: ProductCardPurchase;
  wishlisted: boolean;
  stockMessage: StockMessage;
};

export type CardFeatureFlags = {
  wishlistEnabled: boolean;
  buyNowEnabled: boolean;
  addToCartEnabled: boolean;
};

type MinimalVariant = { id: string; isActive: boolean; isDefault: boolean; stockQty: number };

/**
 * First isDefault+active+in-stock variant; falls back to the first
 * active+in-stock variant; falls back to the first active variant
 * (possibly out of stock, so the card has something concrete to show/
 * block on); falls back to the first variant at all. Preferring an
 * in-stock variant over a merely-marked-default one means the card
 * naturally shows a purchasable option whenever any sibling variant has
 * stock — spec §8 "an in-stock sibling variant remains purchasable."
 */
function resolveDefaultVariant<T extends MinimalVariant>(variants: T[]): T | null {
  if (variants.length === 0) return null;
  return (
    variants.find((v) => v.isDefault && v.isActive && v.stockQty > 0) ??
    variants.find((v) => v.isActive && v.stockQty > 0) ??
    variants.find((v) => v.isActive) ??
    variants[0]!
  );
}

/** spec §8 "If only some variants are out of stock, show 'Some variants are out of stock'" — never applies when every variant is out (that's just the single-variant OUT_OF_STOCK_NOTIFY case) or when none are. */
function computeStockMessage<T extends MinimalVariant>(variants: T[]): StockMessage {
  if (variants.length === 0) return null;
  const active = variants.filter((v) => v.isActive);
  if (active.length === 0) return null;
  const anyOut = active.some((v) => v.stockQty <= 0);
  const allOut = active.every((v) => v.stockQty <= 0);
  return anyOut && !allOut ? "SOME_VARIANTS_OUT_OF_STOCK" : null;
}

function labelForVariant(v: {
  values: Array<{ attributeValue: { value: string; attribute: { name: string } } }>;
}): string {
  return v.values
    .map((x) => `${x.attributeValue.attribute.name}: ${x.attributeValue.value}`)
    .join(", ");
}

/** count 0 shows "New" (never a fake "0.0★"); below threshold omits rating entirely (never a misleadingly sparse number); at/above threshold shows the real average+count. */
function ratingFor(average: unknown, count: number, threshold: number): ProductCardRating {
  if (count === 0) return "NEW";
  if (count >= threshold && average != null) return { average: Number(average), count };
  return null;
}

function discountText(mrp: number, sellingPrice: number): string | null {
  if (sellingPrice >= mrp || mrp <= 0) return null;
  return `${Math.round(((mrp - sellingPrice) / mrp) * 100)}% off`;
}

/**
 * Lowest per-unit price across the product's active variants — the same
 * number the product page prints as "₹X per unit". A variant sold as a
 * multi-piece case is priced per-unit live via computeUnitPrice (its own
 * `sellingPrice` ÷ its "Case" attribute value's piece count — see that
 * function's doc comment); a variant with no "Case" value is already a
 * single sellable unit, so its own `sellingPrice` IS the per-unit price.
 * Falls back to the card's own selling price when the product has no
 * priced variants at all.
 */
function minUnitPriceOf(
  variants: Array<{
    isActive: boolean;
    sellingPrice: unknown;
    values: { attributeValue: { value: string; attribute: { name: string } } }[];
  }>,
  fallback: number,
): number {
  const prices = variants
    .filter((v) => v.isActive)
    .map((v) => {
      const attributeValues = v.values.map((val) => ({
        attributeName: val.attributeValue.attribute.name,
        value: val.attributeValue.value,
      }));
      return computeUnitPrice(Number(v.sellingPrice), attributeValues) ?? Number(v.sellingPrice);
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  return prices.length > 0 ? Math.min(...prices) : fallback;
}

/**
 * The card's lead image must always be the seller's chosen primary image
 * when one is set — `primaryImageUrl` and the `ProductImage` gallery are
 * two independent fields/tables, so a gallery that doesn't happen to
 * include the primary image (a very normal case: the seller added the
 * primary separately from the carousel) previously meant the primary
 * image never appeared on the card at all, replaced by whatever gallery
 * image happened to sort first. Deduped so a primary image that's ALSO
 * in the gallery doesn't show twice.
 */
export function orderedImageUrls(primaryImageUrl: string, galleryUrls: string[]): string[] {
  const rest = galleryUrls.filter((url) => url !== primaryImageUrl);
  return primaryImageUrl ? [primaryImageUrl, ...rest] : rest;
}

type EditorialBadgeRelation = CustomerProduct["editorialBadge"];

function toBadgeTone(tone: "SUCCESS" | "WARNING" | "DANGER" | "INFO"): BadgeTone {
  return tone.toLowerCase() as BadgeTone;
}

/** Priority-2 "deal" candidate — only an EditorialBadge tagged kind=DEAL resolves here, preserving the exact pre-migration DEAL-vs-editorial split (see EditorialBadge's schema doc comment). */
function dealBadgeFromEditorial(
  badge: EditorialBadgeRelation,
): { text: string; tone: BadgeTone } | null {
  if (!badge || badge.kind !== "DEAL") return null;
  return { text: badge.name, tone: toBadgeTone(badge.tone) };
}

/** Priority-4 "editorial" candidate — an admin-managed badge (Best Seller, New, or any other Site Settings-defined kind=EDITORIAL badge). */
function editorialBadgeCandidate(
  badge: EditorialBadgeRelation,
): { text: string; tone: BadgeTone } | null {
  if (!badge || badge.kind !== "EDITORIAL") return null;
  return { text: badge.name, tone: toBadgeTone(badge.tone) };
}

export function adaptCustomerProduct(
  product: CustomerProduct,
  opts: CardAdapterOpts,
): ProductCardData {
  const defaultVariant = resolveDefaultVariant(product.variants);
  const config = product.customerConfig;
  // A variant product's own base config carries the seller's explicit
  // "Display on product card" price (see product-form.tsx) whenever it's
  // been set (mrp > 0) — that always wins over any specific variant's
  // price, so the card shows one deliberate price rather than whichever
  // variant happens to be marked default. Falls back to the default
  // variant's price when there's no real card price yet — the only way
  // that happens is a variant product saved before this field existed
  // (its base config still carries the old zeroed placeholder), so this
  // keeps every pre-existing card looking exactly as it did.
  const configMrp = config ? Number(config.mrp) : 0;
  const hasCardPrice = configMrp > 0;
  const mrp = hasCardPrice ? configMrp : defaultVariant ? Number(defaultVariant.mrp) : 0;
  const sellingPrice = hasCardPrice
    ? Number(config!.sellingPrice)
    : defaultVariant
      ? Number(defaultVariant.sellingPrice)
      : 0;
  const stock = defaultVariant ? defaultVariant.stockQty : (config?.currentStock ?? 0);
  const purchaseBlocked = stock <= 0;

  const badge = resolveCardBadge({
    availability: purchaseBlocked ? { text: "Out of Stock", tone: "danger" } : null,
    deal: dealBadgeFromEditorial(product.editorialBadge),
    delivery: product.deliveryBadgeEnabled
      ? { text: product.deliveryBadgeText || "Fast Delivery", tone: "info" }
      : null,
    editorial: editorialBadgeCandidate(product.editorialBadge),
  });

  return {
    id: product.id,
    href: `/products/${product.slug}`,
    imageUrls: orderedImageUrls(
      product.primaryImageUrl,
      product.images.map((i) => i.url),
    ),
    brandName: product.brand?.name ?? null,
    name: resolveProductName(product, opts.language),
    subtitle: product.subtitle ?? null,
    audience: "CUSTOMER",
    variantLabel: defaultVariant ? labelForVariant(defaultVariant) : null,
    badge,
    rating: ratingFor(product.ratingAverage, product.ratingCount, opts.ratingThreshold),
    pricing: {
      kind: "CUSTOMER",
      mrp,
      sellingPrice,
      discountText: discountText(mrp, sellingPrice),
      minUnitPrice: minUnitPriceOf(product.variants, sellingPrice),
    },
    purchase: purchaseBlocked
      ? {
          kind: "OUT_OF_STOCK_NOTIFY",
          productId: product.id,
          variantId: defaultVariant?.id ?? null,
          audience: "CUSTOMER",
        }
      : {
          kind: "BUY_AND_CART",
          productId: product.id,
          variantId: defaultVariant?.id ?? null,
          minOrderQty: defaultVariant ? defaultVariant.minOrderQty : (config?.minOrderQty ?? 1),
        },
    wishlisted: opts.wishlisted,
    stockMessage: computeStockMessage(product.variants),
  };
}

export function adaptDealerProduct(
  product: DealerProduct,
  opts: CardAdapterOpts,
): ProductCardData {
  const defaultVariant = resolveDefaultVariant(product.variants);
  const config = product.dealerConfig;
  const moq = defaultVariant ? defaultVariant.minOrderQty : (config?.minOrderQty ?? 1);
  // The card's blocking-availability signal AND the purchase-vs-Request-
  // Seller decision are the exact same boolean — Product Card Design Spec:
  // "never display both actions for the same resolved offer/state."
  const purchaseBlocked = !product.availableInState;
  // Stock is a SEPARATE concern from state/licence eligibility (spec §8/
  // §11) — only checked once the product is otherwise legally purchasable,
  // never conflated with purchaseBlocked (which stays state/licence-only
  // so REQUEST_SELLER_ONLY keeps meaning exactly what it always has).
  const stock = defaultVariant ? defaultVariant.stockQty : (config?.currentStock ?? 0);
  const outOfStock = !purchaseBlocked && stock <= 0;

  const badge = resolveCardBadge({
    availability: purchaseBlocked
      ? { text: "Unavailable in your state", tone: "danger" }
      : outOfStock
        ? { text: "Out of Stock", tone: "danger" }
        : null,
    deal: dealBadgeFromEditorial(product.editorialBadge),
    delivery: product.deliveryBadgeEnabled
      ? { text: product.deliveryBadgeText || "Fast Delivery", tone: "info" }
      : null,
    editorial: editorialBadgeCandidate(product.editorialBadge),
  });

  // Price is only ever placed in the card's props when the product is
  // actually purchasable in the dealer's state — see the "conflict
  // resolution" doc comment on DEALER_CATALOGUE_SELECT in
  // packages/catalog/src/queries.ts. This is the enforcement point.
  // Same "explicit card price always wins when it's real, else fall back
  // to the default variant" rule as adaptCustomerProduct above.
  const dealerConfigMrp = config ? Number(config.mrp) : 0;
  const hasDealerCardPrice = dealerConfigMrp > 0;
  const pricing: ProductCardPricing =
    !purchaseBlocked && (defaultVariant || hasDealerCardPrice)
      ? (() => {
          const dsp = hasDealerCardPrice
            ? Number(config!.sellingPrice)
            : Number(defaultVariant!.sellingPrice);
          return {
            kind: "DEALER_PRICED" as const,
            mrp: hasDealerCardPrice ? dealerConfigMrp : Number(defaultVariant!.mrp),
            sellingPrice: dsp,
            moqLabel: `MOQ ${moq}`,
            minUnitPrice: minUnitPriceOf(product.variants, dsp),
          };
        })()
      : { kind: "DEALER_UNPRICED", moqLabel: purchaseBlocked ? null : `MOQ ${moq}` };

  return {
    id: product.id,
    href: `/dealer/products/${product.id}`,
    imageUrls: orderedImageUrls(
      product.primaryImageUrl,
      product.images.map((i) => i.url),
    ),
    brandName: product.brand?.name ?? null,
    name: resolveProductName(product, opts.language),
    subtitle: product.subtitle ?? null,
    audience: "DEALER",
    variantLabel: defaultVariant ? labelForVariant(defaultVariant) : null,
    badge,
    rating: ratingFor(product.ratingAverage, product.ratingCount, opts.ratingThreshold),
    pricing,
    purchase: purchaseBlocked
      ? {
          kind: "REQUEST_SELLER_ONLY",
          requestHref: `/dealer/requests/new?productId=${product.id}${defaultVariant ? `&variantId=${defaultVariant.id}` : ""}`,
        }
      : outOfStock
        ? {
            kind: "OUT_OF_STOCK_NOTIFY",
            productId: product.id,
            variantId: defaultVariant?.id ?? null,
            audience: "DEALER",
          }
        : {
            kind: "BUY_AND_CART",
            productId: product.id,
            variantId: defaultVariant?.id ?? null,
            minOrderQty: moq,
          },
    wishlisted: opts.wishlisted,
    stockMessage: purchaseBlocked ? null : computeStockMessage(product.variants),
  };
}

/**
 * getHomepageModel (packages/catalog/src/homepage.ts) resolves every
 * product for a single viewer audience per call, so a homepage render
 * never actually mixes customer- and dealer-shaped rows in one array — this
 * just picks the matching adapter at the type level via the
 * DealerHomepageProduct-only `availableInState` marker field, rather than
 * threading a separate "which adapter" parameter through every homepage
 * section component.
 */
export function adaptHomepageProduct(
  product: HomepageProduct,
  opts: CardAdapterOpts,
): ProductCardData {
  if ("availableInState" in product) return adaptDealerProduct(product, opts);
  return adaptCustomerProduct(product, opts);
}

/**
 * Homepage CMS "Deal of the Day" (Complete Design/Admin Spec §7.5):
 * overlays the deal price onto an already-adapted customer card and
 * upgrades its badge to "Deal of the Day" — unless the card is already
 * blocked (out of stock), in which case the blocking-availability badge
 * must still win (Product Card Design Spec §Badge priority: availability
 * outranks deal). Deal-of-the-Day is customer-only by construction (see
 * packages/orders/src/pricing-resolution.ts's getActiveDealSellingPrice),
 * so this only ever receives a CUSTOMER-kind card.
 */
export function applyDealOverride(card: ProductCardData, dealPrice: number): ProductCardData {
  if (card.pricing.kind !== "CUSTOMER") return card;
  const overridden: ProductCardData = {
    ...card,
    pricing: {
      kind: "CUSTOMER",
      mrp: card.pricing.mrp,
      sellingPrice: dealPrice,
      discountText: discountText(card.pricing.mrp, dealPrice),
      minUnitPrice:
        dealPrice > 0 ? Math.min(card.pricing.minUnitPrice, dealPrice) : card.pricing.minUnitPrice,
    },
  };
  if (card.purchase.kind === "BUY_AND_CART") {
    overridden.badge = { text: "Deal of the Day", tone: "warning" };
  }
  return overridden;
}
