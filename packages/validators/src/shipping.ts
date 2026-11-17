export type ShippingSlabInput = {
  lowerWeightGrams: number;
  upperWeightGrams: number;
  price: number;
};
export type ShippingConfigInput = {
  maxWeightGrams: number;
  aboveMaxPrice: number;
  slabs: ShippingSlabInput[];
};
export type ShippingMatchResult = { ok: true; price: number } | { ok: false; error: string };

/**
 * Pure slab-matching logic shared by the client (product-form live preview
 * — see apps/dashboard/src/components/product-form.tsx) and the server
 * (packages/catalog/src/logistics-pricing.ts:calculateShippingCostForWeight,
 * the one place a shipping cost actually gets written to the database).
 * Having exactly one implementation is what guarantees the preview a
 * seller sees while typing a weight always matches what the server will
 * actually store — never trust the client-computed value for anything
 * beyond display, though: the server always recomputes from `config`
 * loaded fresh from the database.
 */
export function matchShippingSlab(
  weightGrams: number,
  config: ShippingConfigInput | null,
): ShippingMatchResult {
  if (!config) {
    return {
      ok: false,
      error: "Shipping pricing is not configured yet — ask an admin to set up logistics pricing.",
    };
  }
  if (weightGrams > config.maxWeightGrams) {
    return { ok: true, price: config.aboveMaxPrice };
  }
  const slab = config.slabs.find(
    (s) => weightGrams >= s.lowerWeightGrams && weightGrams <= s.upperWeightGrams,
  );
  if (!slab) {
    // Should not happen against a config that passed validateSlabSet (full
    // continuous coverage up to maxWeightGrams), but fails safe rather
    // than silently returning zero if it somehow does.
    return { ok: false, error: "This weight does not fall into any configured shipping slab." };
  }
  return { ok: true, price: slab.price };
}
