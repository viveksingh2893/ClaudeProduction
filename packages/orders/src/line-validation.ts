import type { BaseUnit } from "@kisan4u/db";
import { isProductAvailableForState, evaluateSellingLicenceEligibility } from "@kisan4u/catalog";
import {
  getProductForCart,
  getVariantForCart,
  resolveAudienceConfig,
  resolveVariantConfig,
  getActiveDealSellingPrice,
} from "./pricing-resolution";

export type LineValidationContext = {
  /** UserRole value at the time of the check — CUSTOMER means customer. Never trust a client-supplied version of this; always resolve from the session + verified profile (Phase 4 spec §A). */
  role: "CUSTOMER" | "DEALER";
  /** The dealer's own verified DealerProfile.stateId — null for a customer, or a dealer with no normalized state (nationwide products only). */
  dealerStateId: string | null;
  /**
   * The customer's resolved delivery-address state — selling-licence module
   * addition. Null/omitted means "not yet known" (e.g. add-to-cart before
   * an address is selected, or a read-only preview rendered pre-address):
   * state/licence eligibility for a CUSTOMER line is only enforced once
   * this is provided, matching spec §13 ("if the customer's state is not
   * yet known... never allow checkout until a valid delivery state has
   * been evaluated" — the hard gate lives at checkout, where the address
   * is always resolved first; see packages/orders/src/checkout.ts).
   */
  customerStateId?: string | null;
};

export type ValidatedLine = {
  productId: string;
  productName: string;
  productImageUrl: string;
  sku: string;
  variantId: string | null;
  variantLabel: string | null;
  sellerId: string;
  sellerName: string;
  unit: BaseUnit;
  mrp: number;
  sellingPrice: number;
  minOrderQty: number;
  currentStock: number;
  weightGrams: number;
  taxPercent: number;
  taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
  licenseRequired: boolean;
  /** Dealer-only reward points per unit of this line — always 0 for a CUSTOMER-audience line. Snapshotted onto OrderItem.loyaltyPoints at checkout. */
  loyaltyPoints: number;
};

/**
 * Machine-readable reason a line failed validation — added alongside the
 * existing human-readable `error` string (never a breaking change to
 * existing callers, which only ever branched on `.ok`) so UI code
 * (specifically the dealer product-detail page's "show Add to Cart vs.
 * Request Seller vs. a specific reason" decision) can branch deterministically
 * instead of string-matching `error`. STATE_UNAVAILABLE is the only reason
 * that should ever surface a "Request Seller" option — every other reason
 * must show the reason itself and offer neither purchase controls nor
 * Request Seller.
 */
export type LineValidationErrorCode =
  | "PRODUCT_UNAVAILABLE"
  | "SELLER_INACTIVE"
  | "WRONG_AUDIENCE"
  | "STATE_UNAVAILABLE"
  | "LICENSE_MISSING"
  | "CONFIG_MISSING"
  | "VARIANT_INVALID"
  | "VARIANT_INACTIVE"
  | "VARIANT_WRONG_AUDIENCE"
  | "BELOW_MIN_QTY"
  | "OUT_OF_STOCK"
  | "WEIGHT_MISSING";

export type LineValidationResult =
  { ok: true; line: ValidatedLine } | { ok: false; error: string; code: LineValidationErrorCode };

/**
 * Selling-licence module addition: checks BOTH that the product's own
 * configured state list (whatever the seller chose within their licensed
 * scope, clamped at save time — see packages/catalog/src/product-submission.ts)
 * covers this state, AND that the seller's licence eligibility for this
 * exact taxonomy path/audience/state is valid RIGHT NOW — never trusting
 * the product's stored state list alone, since it can lag a licence
 * expiry/revocation until the next lazy reconcile sweep (spec §3/§10:
 * "Expiry must work even if a scheduled job is delayed"). Previously this
 * check (isProductAvailableForState + checkSellerLicenseForProduct) only
 * ran for DEALER; it now runs for CUSTOMER too whenever a delivery state
 * is known (spec §13's gap — customers were never state/licence-checked
 * at all before this module).
 */
function checkStateAndLicenceEligibility(
  configuredStates: { id: string }[],
  audienceEligibility: {
    eligibleStateIds: string[];
    isPanIndia: boolean;
    blockingRequirements: { name: string }[];
  },
  stateId: string | null,
): { ok: true } | { ok: false; error: string; code: "STATE_UNAVAILABLE" | "LICENSE_MISSING" } {
  if (!isProductAvailableForState(configuredStates, stateId)) {
    return {
      ok: false,
      error: "This product is not available for delivery to your state.",
      code: "STATE_UNAVAILABLE",
    };
  }
  if (audienceEligibility.blockingRequirements.length > 0) {
    const names = audienceEligibility.blockingRequirements.map((b) => b.name).join(", ");
    return {
      ok: false,
      error: `This product requires a seller licence that is not currently approved: ${names}.`,
      code: "LICENSE_MISSING",
    };
  }
  if (
    !audienceEligibility.isPanIndia &&
    (stateId == null || !audienceEligibility.eligibleStateIds.includes(stateId))
  ) {
    return {
      ok: false,
      error: "This product's seller licence does not cover delivery to your state.",
      code: "LICENSE_MISSING",
    };
  }
  return { ok: true };
}

/**
 * THE single re-check every cart mutation and every checkout revalidation
 * must call — implements Phase 4 spec §B3 in one place rather than
 * duplicating it between "add to cart" and "checkout." Every value in the
 * returned line is read fresh from the database; `productId`/`variantId`
 * are the only inputs ever trusted from the caller — quantity, price,
 * seller id, and shipping weight are always derived here, never accepted
 * from a browser-supplied value.
 */
export async function validateCartLine(
  productId: string,
  variantId: string | null,
  quantity: number,
  ctx: LineValidationContext,
): Promise<LineValidationResult> {
  const product = await getProductForCart(productId);
  if (!product || !product.sellerId || !product.seller)
    return {
      ok: false,
      error: "This product is no longer available.",
      code: "PRODUCT_UNAVAILABLE",
    };
  if (product.lifecycleStatus !== "APPROVED")
    return {
      ok: false,
      error: "This product is no longer available.",
      code: "PRODUCT_UNAVAILABLE",
    };
  if (product.seller.status !== "APPROVED")
    return { ok: false, error: "This seller is not currently active.", code: "SELLER_INACTIVE" };

  const audience: "CUSTOMER" | "DEALER" = ctx.role === "DEALER" ? "DEALER" : "CUSTOMER";
  const visible = audience === "CUSTOMER" ? product.customerVisible : product.dealerVisible;
  const audienceOk =
    audience === "CUSTOMER"
      ? product.audience === "CUSTOMER_ONLY" || product.audience === "BOTH_CUSTOMER_AND_DEALER"
      : product.audience === "DEALER_ONLY" || product.audience === "BOTH_CUSTOMER_AND_DEALER";
  if (!visible || !audienceOk)
    return {
      ok: false,
      error: "This product is not available to your account type.",
      code: "WRONG_AUDIENCE",
    };

  // Computed once regardless of audience/state-known-ness — reused below
  // both for the state/licence gate and for the ValidatedLine's
  // licenseRequired snapshot, instead of two separate DB round trips.
  const eligibility = await evaluateSellingLicenceEligibility(product.sellerId, {
    categoryId: product.categoryId,
    subCategoryId: product.subCategoryId,
    subSubCategoryId: product.subSubCategoryId,
  });

  if (audience === "DEALER") {
    const check = checkStateAndLicenceEligibility(
      product.dealerAvailableStates,
      eligibility.dealer,
      ctx.dealerStateId,
    );
    if (!check.ok) return check;
  } else if (ctx.customerStateId != null) {
    // See LineValidationContext.customerStateId doc comment — skipped
    // entirely when the customer's delivery state isn't known yet;
    // checkout.ts always resolves the address first, so this always runs
    // by the time an order can actually be placed.
    const check = checkStateAndLicenceEligibility(
      product.customerAvailableStates,
      eligibility.customer,
      ctx.customerStateId,
    );
    if (!check.ok) return check;
  }

  const baseConfig = resolveAudienceConfig(product, audience);
  if (!baseConfig)
    return {
      ok: false,
      error: "This product is not configured for your account type.",
      code: "CONFIG_MISSING",
    };

  let sku = product.sku;
  let variantLabel: string | null = null;
  let mrp = baseConfig.mrp;
  let sellingPrice = baseConfig.sellingPrice;
  let minOrderQty = baseConfig.minOrderQty;
  let currentStock = baseConfig.currentStock;
  let weightGrams = baseConfig.weightGrams;
  const taxPercent = baseConfig.taxPercent; // tax rate always comes from the product's own audience config, even for a variant line
  let taxCalcMode = baseConfig.taxCalcMode;
  let imageUrl: string | null = product.primaryImageUrl;
  let loyaltyPoints = baseConfig.loyaltyPoints;

  if (variantId) {
    const variant = await getVariantForCart(variantId);
    if (!variant || variant.productId !== product.id) {
      return {
        ok: false,
        error: "Selected option does not belong to this product.",
        code: "VARIANT_INVALID",
      };
    }
    if (!variant.isActive)
      return { ok: false, error: "Selected option is no longer active.", code: "VARIANT_INACTIVE" };
    if (variant.audience !== audience)
      return {
        ok: false,
        error: "Selected option is not available to your account type.",
        code: "VARIANT_WRONG_AUDIENCE",
      };

    const variantConfig = resolveVariantConfig(variant);
    sku = variantConfig.sku;
    variantLabel = variantConfig.label;
    mrp = variantConfig.mrp;
    sellingPrice = variantConfig.sellingPrice;
    minOrderQty = variantConfig.minOrderQty;
    currentStock = variantConfig.currentStock;
    weightGrams = variantConfig.weightGrams;
    imageUrl = variantConfig.imageUrl ?? product.primaryImageUrl;
    loyaltyPoints = variantConfig.loyaltyPoints;
    taxCalcMode = variantConfig.taxCalcMode;
  }

  if (quantity < minOrderQty) {
    return {
      ok: false,
      error: `Minimum order quantity for this product is ${minOrderQty}.`,
      code: "BELOW_MIN_QTY",
    };
  }
  if (currentStock < quantity) {
    return {
      ok: false,
      error: "Insufficient stock for the requested quantity.",
      code: "OUT_OF_STOCK",
    };
  }
  if (weightGrams == null) {
    return {
      ok: false,
      error: "Shipping weight is not configured for this product yet.",
      code: "WEIGHT_MISSING",
    };
  }

  const activeDealPrice = await getActiveDealSellingPrice(product.id, variantId ?? null, audience);
  if (activeDealPrice != null) sellingPrice = activeDealPrice;

  const licenseRequired = eligibility.requirements.some((r) =>
    audience === "CUSTOMER" ? r.customer.required : r.dealer.required,
  );

  return {
    ok: true,
    line: {
      productId: product.id,
      productName: product.name,
      productImageUrl: imageUrl,
      sku,
      variantId: variantId ?? null,
      variantLabel,
      sellerId: product.sellerId,
      sellerName: product.seller.shopName,
      unit: product.baseUnit,
      mrp,
      sellingPrice,
      minOrderQty,
      currentStock,
      weightGrams,
      taxPercent,
      taxCalcMode,
      licenseRequired,
      loyaltyPoints,
    },
  };
}
