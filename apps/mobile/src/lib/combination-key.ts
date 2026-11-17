/**
 * Mirrors packages/catalog/src/combination-key.ts exactly. Kept as a plain
 * copy (like order-status-labels.ts already does for other pure logic)
 * rather than an `@kisan4u/catalog` runtime dependency, since that package's
 * barrel also re-exports Prisma-backed modules Metro/Hermes can't bundle.
 * If packages/catalog/src/combination-key.ts changes, mirror the change here.
 */
export function buildCombinationKey(attributeValueIds: string[]): string {
  return [...attributeValueIds].sort().join(",");
}
