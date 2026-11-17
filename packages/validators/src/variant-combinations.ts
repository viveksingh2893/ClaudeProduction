/**
 * Client-safe Cartesian product helper — used by the product form's
 * "Generate variants" convenience button (a starting point the seller/
 * admin can then prune/edit; the server never requires the *complete*
 * Cartesian set to be present, only that whatever IS submitted is
 * internally consistent — see packages/catalog/src/product-submission.ts).
 * Pure array logic, zero DB dependency, so it's safe to import from a
 * "use client" component (unlike packages/catalog, which pulls in
 * @kisan4u/db/Prisma and cannot run in the browser).
 */
export function generateCombinations<T>(valuesByAttribute: T[][]): T[][] {
  if (valuesByAttribute.some((values) => values.length === 0)) return [];
  return valuesByAttribute.reduce<T[][]>(
    (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
    [[]],
  );
}

/**
 * Shared by the client-side form (pre-submission duplicate detection) and
 * the server (packages/validators/src/catalog.ts, packages/catalog's
 * product-submission) so both sides compute the exact same key from the
 * exact same refs — a variant's "identity" for dedup purposes is the sorted
 * set of attributeId:slug pairs it carries, before any real
 * ProductVariantAttributeValue id exists.
 */
export function combinationKeyFromRefs(refs: Array<{ attributeId: string; slug: string }>): string {
  return [...refs]
    .map((r) => `${r.attributeId}:${r.slug}`)
    .sort()
    .join(",");
}
