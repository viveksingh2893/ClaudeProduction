import { prisma } from "@kisan4u/db";

/**
 * Phase 4 addition. packages/catalog's dealer-facing queries deliberately
 * exclude price fields (DEALER_SAFE_CONFIG_SELECT/DEALER_SAFE_VARIANT_SELECT
 * in queries.ts — dealer pricing is hidden pre-enquiry in the public
 * catalogue/"Request Seller" flow). Cart/checkout is the first place an
 * approved dealer is authorized to see their own price, so this is a new,
 * separate query path — it must never be reused by a public catalogue page.
 */
const CART_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  primaryImageUrl: true,
  sku: true,
  audience: true,
  baseUnit: true,
  lifecycleStatus: true,
  customerVisible: true,
  dealerVisible: true,
  sellerId: true,
  // Single tax rate shared by every audience/variant — see
  // Product.taxPercent's schema comment.
  taxPercent: true,
  seller: { select: { id: true, shopName: true, status: true } },
  categoryId: true,
  subCategoryId: true,
  subSubCategoryId: true,
  customerAvailableStates: { select: { id: true } },
  dealerAvailableStates: { select: { id: true } },
  customerConfig: true,
  dealerConfig: true,
} as const;

export type CartProduct = NonNullable<Awaited<ReturnType<typeof getProductForCart>>>;

export async function getProductForCart(productId: string) {
  return prisma.product.findUnique({ where: { id: productId }, select: CART_PRODUCT_SELECT });
}

const CART_VARIANT_SELECT = {
  id: true,
  productId: true,
  audience: true,
  sku: true,
  isActive: true,
  mrp: true,
  sellingPrice: true,
  minOrderQty: true,
  stockQty: true,
  weight: true,
  imageUrl: true,
  imageAlt: true,
  loyaltyPoints: true,
  taxCalcMode: true,
  values: {
    select: {
      attributeValue: { select: { value: true, attribute: { select: { name: true } } } },
    },
  },
} as const;

export type CartVariant = NonNullable<Awaited<ReturnType<typeof getVariantForCart>>>;

export async function getVariantForCart(variantId: string) {
  return prisma.productVariant.findUnique({
    where: { id: variantId },
    select: CART_VARIANT_SELECT,
  });
}

/** "Size: M, Color: Green" — built from the variant's own attribute values, never stored redundantly on the variant row. */
export function formatVariantLabel(variant: Pick<CartVariant, "values">): string {
  return variant.values
    .map((v) => `${v.attributeValue.attribute.name}: ${v.attributeValue.value}`)
    .join(", ");
}

export type ResolvedAudienceConfig = {
  mrp: number;
  sellingPrice: number;
  minOrderQty: number;
  currentStock: number;
  weightGrams: number | null;
  taxPercent: number;
  loyaltyPoints: number;
  /** Whether `sellingPrice` above already has tax baked in — see the Prisma TaxCalcMode enum's doc comment and money.ts's resolveTaxBreakdown. */
  taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
};

/**
 * Reads whichever of ProductCustomerConfig/ProductDealerConfig applies —
 * `sellingPrice` on both is already server-computed and kept current by
 * packages/catalog's product-submission flow (Phase 3 fix: selling price
 * is never entered directly), so this never recomputes it — just reads the
 * live database value, which is exactly what makes §B4 ("always use the
 * latest valid price") correct by construction.
 */
export function resolveAudienceConfig(
  product: CartProduct,
  audience: "CUSTOMER" | "DEALER",
): ResolvedAudienceConfig | null {
  const config = audience === "CUSTOMER" ? product.customerConfig : product.dealerConfig;
  if (!config) return null;
  return {
    mrp: Number(config.mrp),
    sellingPrice: Number(config.sellingPrice),
    minOrderQty: config.minOrderQty,
    currentStock: config.currentStock,
    weightGrams: config.weight,
    // Product-level, not per-audience-config — see Product.taxPercent's
    // schema comment.
    taxPercent: Number(product.taxPercent),
    loyaltyPoints: config.loyaltyPoints,
    taxCalcMode: config.taxCalcMode,
  };
}

export type ResolvedVariantConfig = ResolvedAudienceConfig & {
  sku: string;
  label: string;
  imageUrl: string | null;
};

export function resolveVariantConfig(variant: CartVariant): ResolvedVariantConfig {
  return {
    mrp: Number(variant.mrp),
    sellingPrice: Number(variant.sellingPrice),
    minOrderQty: variant.minOrderQty,
    currentStock: variant.stockQty,
    weightGrams: variant.weight,
    taxPercent: 0, // variants don't carry their own tax rate — the parent product's audience config tax rate applies (see resolveLineContext)
    sku: variant.sku,
    label: formatVariantLabel(variant),
    imageUrl: variant.imageUrl,
    // Nullable on the variant row itself (unset = not configured), unlike
    // config.loyaltyPoints which defaults to 0 — never inherits the base
    // product's value, since each variant/case-size is expected to set its
    // own (see ProductVariant.loyaltyPoints's schema comment).
    loyaltyPoints: variant.loyaltyPoints ?? 0,
    // Unlike taxPercent above, taxCalcMode DOES live per variant (the
    // product form gives every variant its own dropdown) — this
    // overrides the base audience config's value when a variant line is
    // selected, same override pattern as sellingPrice itself.
    taxCalcMode: variant.taxCalcMode,
  };
}

/**
 * Homepage CMS "Deal of the Day" (Complete Design/Admin Spec §7.5): "at end
 * time, disable promotional pricing atomically ... the timer does not
 * reserve stock." This is the authoritative enforcement point — the same
 * call site every other selling price resolves through
 * (line-validation.ts's validateCartLine, used by both cart mutation and
 * checkout revalidation) — so an expired deal can never be purchased at
 * the stale price even from a browser tab that hasn't refreshed its
 * client-side countdown. A variant-specific deal (if one exists for this
 * exact variant) takes priority over a product-level deal.
 *
 * Deliberately CUSTOMER/CUSTOMER-only: DealOfTheDay has no audience-specific
 * price, and applying one flat deal price to dealer checkout would let a
 * dealer buy at a retail promotional price, breaking the customer/dealer
 * price-segregation invariant (Complete Design/Admin Spec §3.3). The admin
 * Deal of the Day picker in this pass only ever discounts the customer
 * price; a dealer-specific deal price is out of scope.
 */
export async function getActiveDealSellingPrice(
  productId: string,
  variantId: string | null,
  audience: "CUSTOMER" | "DEALER",
): Promise<number | null> {
  if (audience !== "CUSTOMER") return null;
  const now = new Date();
  const baseWhere = { productId, isActive: true, startAt: { lte: now }, endAt: { gt: now } };

  if (variantId) {
    const variantDeal = await prisma.dealOfTheDay.findFirst({ where: { ...baseWhere, variantId } });
    if (variantDeal) return Number(variantDeal.dealPrice);
  }
  const productDeal = await prisma.dealOfTheDay.findFirst({
    where: { ...baseWhere, variantId: null },
  });
  return productDeal ? Number(productDeal.dealPrice) : null;
}
