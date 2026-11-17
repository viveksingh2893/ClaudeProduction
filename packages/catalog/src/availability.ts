/**
 * Phase 4 addition: extracted from three independent copies of the same
 * check (packages/catalog/src/queries.ts:getDealerCatalogue,
 * getDealerProductDetail, and product-requests.ts:createProductRequest) —
 * a product with zero `availableStates` rows is nationwide; a product with
 * at least one row is restricted to exactly those states. Centralizing it
 * here means cart/checkout (Phase 4) reuses the exact same rule instead of
 * writing a fourth copy.
 */
export function isProductAvailableForState(
  availableStates: { id: string }[],
  stateId: string | null | undefined,
): boolean {
  if (availableStates.length === 0) return true;
  return stateId != null && availableStates.some((s) => s.id === stateId);
}

type PriceBearing = { mrp: unknown; sellingPrice: unknown };

/**
 * A state-unavailable dealer product must still show its variants
 * (attributes, images, stock-shape) but never any price — apps/web's
 * `adaptDealerProduct` already enforces this for the server-rendered
 * product card by simply never placing price fields into the card props
 * it builds. The mobile JSON API routes (apps/web/src/app/api/mobile/v1/
 * dealer/products/route.ts and products/[id]/route.ts) have no such
 * boundary — they serialize the raw catalog row straight to the wire — so
 * this does the same redaction explicitly, in one place, before any
 * dealer-facing API response is built. Never send `dealerConfig`/variant
 * `mrp`/`sellingPrice` for a product that isn't available in the dealer's
 * own verified state.
 */
export function redactDealerPricingIfUnavailable<
  TConfig extends PriceBearing,
  TVariant extends PriceBearing,
  T extends { availableInState: boolean; dealerConfig: TConfig | null; variants: TVariant[] },
>(product: T): T {
  if (product.availableInState) return product;
  const dealerConfig = product.dealerConfig
    ? ({ ...product.dealerConfig, mrp: null, sellingPrice: null } as TConfig)
    : null;
  const variants = product.variants.map(
    (v) => ({ ...v, mrp: null, sellingPrice: null }) as TVariant,
  );
  return { ...product, dealerConfig, variants };
}
