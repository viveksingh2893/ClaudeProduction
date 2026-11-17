import { prisma, type MerchandisingType } from "@kisan4u/db";

export type ProductPlacementResult = { ok: true } | { ok: false; error: string };

/**
 * Manual homepage product placement — Trending / Best Sellers / New
 * Arrivals (Phase: manual curation only; organic/analytics-based ranking
 * is a later phase — see getManualHomepageProducts's doc comment in
 * homepage.ts). Reuses MerchandisingCollection/MerchandisingItem (already
 * modelled for exactly this: one global collection per type, categoryId
 * null, an ordered item list) rather than a new table — the smallest safe
 * schema change here was none at all.
 *
 * Deliberately independent of MerchandisingCollection.mode: the older
 * AUTOMATIC/MANUAL toggle (still reachable only from the now-unlinked
 * /admin/homepage/discovery screen) is untouched by this module and these
 * functions never read it — every write here is unconditionally manual,
 * and getManualHomepageProducts (homepage.ts) unconditionally reads only
 * the item list, regardless of what `mode` says.
 */

const SECTION_TYPES: MerchandisingType[] = ["TRENDING", "BEST_SELLERS", "NEW_ARRIVALS"];

/** Per-section cap — Best Sellers holds 12 (homepage shows a 2×3 / 4×3 grid), the others 10. Category rank (FEATURED_BY_CATEGORY, per category) is 10. */
export function maxItemsForSection(type: MerchandisingType): number {
  return type === "BEST_SELLERS" ? 12 : 10;
}
const MAX_CATEGORY_RANK = 10;

async function getOrCreateSectionCollection(type: MerchandisingType) {
  const existing = await prisma.merchandisingCollection.findFirst({
    where: { type, categoryId: null },
  });
  if (existing) return existing;
  return prisma.merchandisingCollection.create({ data: { type, mode: "MANUAL", isActive: true } });
}

async function getOrCreateCategoryCollection(categoryId: string) {
  const existing = await prisma.merchandisingCollection.findFirst({
    where: { type: "FEATURED_BY_CATEGORY", categoryId },
  });
  if (existing) return existing;
  return prisma.merchandisingCollection.create({
    data: { type: "FEATURED_BY_CATEGORY", categoryId, mode: "MANUAL", isActive: true },
  });
}

/**
 * For the /admin/products table's placement badges — one query per
 * section type (3 total, not one per product row) keyed by productId so
 * rendering N product rows costs O(1) lookups, not O(N) queries.
 */
export type ProductPlacementMap = Map<string, Partial<Record<MerchandisingType, number>>>;

export async function getProductPlacementsMap(): Promise<ProductPlacementMap> {
  const items = await prisma.merchandisingItem.findMany({
    where: { collection: { type: { in: SECTION_TYPES }, categoryId: null } },
    select: { productId: true, position: true, collection: { select: { type: true } } },
    orderBy: { position: "asc" },
  });
  const map: ProductPlacementMap = new Map();
  for (const item of items) {
    const entry = map.get(item.productId) ?? {};
    entry[item.collection.type] = item.position + 1; // 0-based storage -> 1-based admin display
    map.set(item.productId, entry);
  }
  return map;
}

/**
 * The per-product "category rank" for the /admin/products table — a
 * product's 1-based position inside the FEATURED_BY_CATEGORY collection
 * for its OWN category. One query for every category's list keyed by
 * productId (O(1) per row).
 */
export async function getProductCategoryRankMap(): Promise<Map<string, number>> {
  const items = await prisma.merchandisingItem.findMany({
    where: { collection: { type: "FEATURED_BY_CATEGORY" } },
    select: { productId: true, position: true },
    orderBy: { position: "asc" },
  });
  const map = new Map<string, number>();
  for (const item of items) {
    if (!map.has(item.productId)) map.set(item.productId, item.position + 1);
  }
  return map;
}

/**
 * The ordered product ids for ONE category's rank list (the
 * FEATURED_BY_CATEGORY collection for that category), position 1 first,
 * capped at MAX_CATEGORY_RANK (10). Used to front-load the category
 * page's product feed: these ids come first, in this order, then every
 * other product in the category. Returns [] when the category has no
 * ranked products.
 */
export async function getCategoryRankedProductIds(categoryId: string): Promise<string[]> {
  const items = await prisma.merchandisingItem.findMany({
    where: { collection: { type: "FEATURED_BY_CATEGORY", categoryId } },
    orderBy: { position: "asc" },
    take: MAX_CATEGORY_RANK,
    select: { productId: true },
  });
  return items.map((i) => i.productId);
}

/**
 * Sets (or clears, when `position` is null) productId's position within
 * `type`'s section. Implemented the same "remove from the ordered list,
 * then reinsert at the target index, then rewrite the whole list in one
 * transaction" way as setTopLevelCategoryPosition (category-hierarchy.ts)
 * — atomic, always leaves a clean contiguous 0-based sequence, and
 * naturally covers add/move/remove with one code path instead of three.
 */
export async function setProductSectionPlacement(
  type: MerchandisingType,
  productId: string,
  position: number | null,
): Promise<ProductPlacementResult> {
  const collection = await getOrCreateSectionCollection(type);

  const currentItems = await prisma.merchandisingItem.findMany({
    where: { collectionId: collection.id },
    orderBy: { position: "asc" },
    select: { productId: true },
  });
  let ids = currentItems.map((i) => i.productId);
  const alreadyIn = ids.includes(productId);
  ids = ids.filter((id) => id !== productId);

  const cap = maxItemsForSection(type);
  if (position !== null) {
    if (!alreadyIn) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { lifecycleStatus: true },
      });
      if (!product || product.lifecycleStatus !== "APPROVED") {
        return { ok: false, error: "Only approved products can be added to a homepage section." };
      }
      if (ids.length >= cap) {
        return {
          ok: false,
          error: `This section already has ${cap} products — remove one before adding another.`,
        };
      }
    }
    const insertIndex = Math.min(Math.max(Math.trunc(position) - 1, 0), ids.length);
    ids.splice(insertIndex, 0, productId);
  }

  await prisma.$transaction([
    prisma.merchandisingItem.deleteMany({ where: { collectionId: collection.id } }),
    ...(ids.length > 0
      ? [
          prisma.merchandisingItem.createMany({
            data: ids.map((id, i) => ({ collectionId: collection.id, productId: id, position: i })),
          }),
        ]
      : []),
  ]);

  return { ok: true };
}

/**
 * Same "remove, reinsert, rewrite the whole list" algorithm as
 * setProductSectionPlacement above, but scoped to the FEATURED_BY_CATEGORY
 * collection for the product's OWN category (resolved here, never passed
 * in — a product's category rank always belongs to its own category).
 * `position` null clears it. Cap 10 per category.
 */
export async function setProductCategoryPlacement(
  productId: string,
  position: number | null,
): Promise<ProductPlacementResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true, lifecycleStatus: true },
  });
  if (!product) return { ok: false, error: "Product not found." };

  const collection = await getOrCreateCategoryCollection(product.categoryId);

  const currentItems = await prisma.merchandisingItem.findMany({
    where: { collectionId: collection.id },
    orderBy: { position: "asc" },
    select: { productId: true },
  });
  let ids = currentItems.map((i) => i.productId);
  const alreadyIn = ids.includes(productId);
  ids = ids.filter((id) => id !== productId);

  if (position !== null) {
    if (!alreadyIn) {
      if (product.lifecycleStatus !== "APPROVED") {
        return { ok: false, error: "Only approved products can be ranked in a category section." };
      }
      if (ids.length >= MAX_CATEGORY_RANK) {
        return {
          ok: false,
          error: `This category already has ${MAX_CATEGORY_RANK} ranked products — clear one first.`,
        };
      }
    }
    const insertIndex = Math.min(Math.max(Math.trunc(position) - 1, 0), ids.length);
    ids.splice(insertIndex, 0, productId);
  }

  await prisma.$transaction([
    prisma.merchandisingItem.deleteMany({ where: { collectionId: collection.id } }),
    ...(ids.length > 0
      ? [
          prisma.merchandisingItem.createMany({
            data: ids.map((id, i) => ({ collectionId: collection.id, productId: id, position: i })),
          }),
        ]
      : []),
  ]);

  return { ok: true };
}
