/**
 * Moved to packages/catalog/src/product-card-adapter.ts so apps/dashboard's
 * POS product grid (spec §11/§12) can reuse the exact same card
 * pricing/availability/badge logic instead of a second copy — this file
 * is now just a re-export so the many existing `@/lib/product-card-adapter`
 * imports across this app don't all need to change.
 */
export * from "@kisan4u/catalog";
