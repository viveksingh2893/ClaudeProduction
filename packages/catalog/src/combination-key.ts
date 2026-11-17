/**
 * Deterministic join of a variant's attribute-value ids, used as the
 * `ProductVariant.combinationKey` column so "no duplicate variant
 * combination per product+audience" is a real `@@unique` database
 * constraint (see packages/db/prisma/schema.prisma) instead of an
 * app-only check that a race condition could slip past. Sorting makes
 * the key independent of the order attributes were selected in.
 */
export function buildCombinationKey(attributeValueIds: string[]): string {
  return [...attributeValueIds].sort().join(",");
}
