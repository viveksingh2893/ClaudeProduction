import { prisma, Prisma, type HomepageSectionType, type MerchandisingType } from "@kisan4u/db";
import { type DbLanguage, DEFAULT_DB_LANGUAGE } from "@kisan4u/validators";
import { isProductAvailableForState } from "./availability";
import {
  CUSTOMER_VISIBLE_WHERE,
  CUSTOMER_INCLUDE,
  DEALER_VISIBLE_WHERE,
  DEALER_CATALOGUE_SELECT,
} from "./queries";

/**
 * Complete Design/Admin Spec §12.3: getHomepageModel(viewerContext) — one
 * function resolving every published, in-schedule-window, audience-
 * eligible homepage section + its content, so apps/web's homepage page
 * becomes a thin renderer instead of hand-coding this logic (§6.1: "All
 * product sections must resolve role, state, active price, inventory and
 * publication before display"). Caching (Next's unstable_cache/
 * revalidateTag) is a Next.js-specific concern and lives in the apps/web
 * call site, not here — this package has no framework dependency.
 */
export type HomepageViewerAudience = "CUSTOMER" | "DEALER";

export type HomepageViewer = {
  audience: HomepageViewerAudience;
  /** Approved dealer's verified state — ignored for CUSTOMER viewers. */
  dealerStateId?: string | null;
};

export type PromotionalAssetDTO = Awaited<ReturnType<typeof getEligiblePromotionalAssets>>[number];
export type BrandAssetDTO = Awaited<ReturnType<typeof getActiveShopByBrand>>[number];
export type DealDTO = Awaited<ReturnType<typeof getActiveDeals>>[number];

// Explicit union (not inferred from resolveProductsByIds' return type) so
// every generic array helper below (orderByIds) can be typed against a
// single concrete union instead of TypeScript trying to unify two
// differently-shaped Prisma payload types from an inferred function return.
type CustomerHomepageProduct = Prisma.ProductGetPayload<{ include: typeof CUSTOMER_INCLUDE }>;
type DealerHomepageProduct = Prisma.ProductGetPayload<{
  select: typeof DEALER_CATALOGUE_SELECT;
}> & {
  availableInState: boolean;
};
export type HomepageProduct = CustomerHomepageProduct | DealerHomepageProduct;

export type HomepageSectionModel =
  | { type: "TRUST_STRIP" }
  | { type: "DEAL_OF_THE_DAY"; deals: DealDTO[] }
  | {
      type: "JOIN_DEALER_SELLER";
      dealerAsset: PromotionalAssetDTO | null;
      sellerAsset: PromotionalAssetDTO | null;
    }
  | {
      type: "FEATURED_BY_CATEGORY";
      groups: Array<{
        category: { id: string; name: string; slug: string };
        products: HomepageProduct[];
      }>;
    };

export type HomepageModel = { sections: HomepageSectionModel[] };

function inScheduleWindow(now: Date, startAt: Date | null, endAt: Date | null): boolean {
  if (startAt && startAt > now) return false;
  if (endAt && endAt <= now) return false;
  return true;
}

async function resolveProductsByIds(
  ids: string[],
  audience: HomepageViewerAudience,
  dealerStateId: string | null,
): Promise<HomepageProduct[]> {
  if (ids.length === 0) return [];
  if (audience === "CUSTOMER") {
    return prisma.product.findMany({
      where: { id: { in: ids }, ...CUSTOMER_VISIBLE_WHERE },
      include: CUSTOMER_INCLUDE,
    });
  }
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, ...DEALER_VISIBLE_WHERE },
    select: DEALER_CATALOGUE_SELECT,
  });
  return rows.map((p) => ({
    ...p,
    availableInState: isProductAvailableForState(p.dealerAvailableStates, dealerStateId),
  }));
}

/** Orders the resolved products to match `ids` (Prisma's `id: { in }` does not preserve array order). */
function orderByIds<T extends { id: string }>(ids: string[], resolved: T[]): T[] {
  const byId = new Map(resolved.map((p) => [p.id, p]));
  const ordered: T[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) ordered.push(p);
  }
  return ordered;
}

async function resolveFeaturedByCategory(
  audience: HomepageViewerAudience,
  dealerStateId: string | null,
) {
  const collections = await prisma.merchandisingCollection.findMany({
    where: { type: "FEATURED_BY_CATEGORY", isActive: true, categoryId: { not: null } },
    include: { category: true, items: { orderBy: { position: "asc" } } },
    take: 5,
  });

  const groups: Array<{
    category: { id: string; name: string; slug: string };
    products: HomepageProduct[];
  }> = [];
  for (const c of collections) {
    if (!c.category) continue;
    const ids = c.items.slice(0, 10).map((i) => i.productId);
    if (ids.length === 0) continue;
    const resolved = await resolveProductsByIds(ids, audience, dealerStateId);
    const ordered = orderByIds(ids, resolved);
    if (ordered.length > 0) {
      groups.push({
        category: { id: c.category.id, name: c.category.name, slug: c.category.slug },
        products: ordered,
      });
    }
  }
  return groups;
}

/**
 * `includeCommon` defaults to true (JOIN_DEALER/JOIN_SELLER's existing
 * behavior, unchanged: a shared COMMON row still falls back for either
 * audience). HERO and COUPON banners deliberately pass `false` — per
 * product decision, "common" banners are no longer a concept for these two
 * placements: an admin who wants the same banner for both audiences now
 * creates two individual rows (see admin/banners' AudienceToggle) rather
 * than relying on a shared COMMON row.
 */
async function getEligiblePromotionalAssets(
  placement: "HERO" | "COUPON" | "HERO_SECONDARY" | "JOIN_DEALER" | "JOIN_SELLER",
  audience: HomepageViewerAudience,
  includeCommon = true,
  /**
   * Homepage redesign, phase B/C banner targeting (#2). `undefined` = no
   * category filter at all (every banner of this placement, the pre-#2
   * behavior). `null` = only banners not tied to a category — i.e. the
   * home page / all surface. A string = only banners tied to that exact
   * category, for its own category page.
   */
  categoryId?: string | null,
  /**
   * Storefront content language. When a language other than EN has no
   * eligible banner for this placement+audience, we fall back to the EN
   * rows so the carousel is never blank just because a translation wasn't
   * uploaded (i18n, 2026-09).
   */
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  const now = new Date();
  const baseWhere = {
    placement,
    isActive: true,
    audience: includeCommon
      ? { in: [audience, "COMMON" as const] }
      : audience,
    ...(categoryId === undefined ? {} : { categoryId }),
  };
  const run = async (lang: DbLanguage) => {
    const rows = await prisma.promotionalAsset.findMany({
      where: { ...baseWhere, language: lang },
      orderBy: { priority: "asc" },
    });
    return rows.filter((r) => inScheduleWindow(now, r.startAt, r.endAt));
  };
  const rows = await run(language);
  if (rows.length === 0 && language !== DEFAULT_DB_LANGUAGE) {
    return run(DEFAULT_DB_LANGUAGE);
  }
  return rows;
}

async function getActiveDeals(audience: HomepageViewerAudience, dealerStateId: string | null) {
  // Deliberately CUSTOMER-only — see pricing-resolution.ts's
  // getActiveDealSellingPrice doc comment: a DealOfTheDay row has no
  // audience-specific price, so showing it to a dealer viewer would
  // advertise a price checkout will never actually honor for them.
  if (audience !== "CUSTOMER") return [];
  const now = new Date();
  const deals = await prisma.dealOfTheDay.findMany({
    where: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
  });
  if (deals.length === 0) return [];
  const productIds = deals.map((d) => d.productId);
  const products = await resolveProductsByIds(productIds, audience, dealerStateId);
  const byProductId = new Map(products.map((p) => [p.id, p]));
  return deals
    .map((d) => ({
      ...d,
      dealPrice: Number(d.dealPrice),
      product: byProductId.get(d.productId) ?? null,
    }))
    .filter((d) => d.product != null);
}

/**
 * Homepage "Shop by Brand" rail — approved brands with a homepage position
 * set (see Brand.homepagePosition, managed at /admin/homepage/brands).
 * Independent of HomepageSection/getHomepageModel, same reasoning as
 * getActiveHeroBanners and getActiveTopLevelCategoriesForHomepage: it sits
 * in a fixed position on both apps/web's homepage and the mobile app's
 * homepage (directly below the banner carousel), not an admin-orderable
 * slot among the other HomepageSection types.
 */
/**
 * Not every approved, positioned brand actually sells to both audiences —
 * a brand can carry only DEALER_ONLY (or only CUSTOMER_ONLY) products, or
 * none currently APPROVED/visible at all. "Shop by Brand" only makes
 * sense as a shortcut into a brand's own products, so a brand with zero
 * eligible products for THIS viewer is excluded rather than shown as a
 * dead end.
 */
export async function getActiveShopByBrand(audience: "CUSTOMER" | "DEALER") {
  const productWhere = audience === "CUSTOMER" ? CUSTOMER_VISIBLE_WHERE : DEALER_VISIBLE_WHERE;
  return prisma.brand.findMany({
    where: {
      status: "APPROVED",
      homepagePosition: { not: null },
      products: { some: productWhere },
    },
    orderBy: [{ homepagePosition: "asc" }, { name: "asc" }],
  });
}

export async function getHomepageModel(viewer: HomepageViewer): Promise<HomepageModel> {
  const now = new Date();
  const dealerStateId = viewer.dealerStateId ?? null;

  const sectionRows = await prisma.homepageSection.findMany({
    where: { enabled: true, audience: { in: [viewer.audience, "COMMON"] } },
    orderBy: { position: "asc" },
  });

  // (type, audience) is unique, but a COMMON row and a viewer-audience-
  // specific row for the same type CAN both exist and both match the
  // `where` above — render at most one row per type. Schedule-eligibility
  // is checked PER ROW first (so a not-yet-started or expired
  // audience-specific row is discarded outright, never allowed to shadow
  // an already-eligible COMMON row of the same type), and only THEN is one
  // row per type chosen from what's left, preferring the more specific
  // audience match over COMMON when both happen to be eligible.
  const eligible = sectionRows.filter((row) => inScheduleWindow(now, row.startAt, row.endAt));
  const byType = new Map<HomepageSectionType, (typeof sectionRows)[number]>();
  for (const row of eligible) {
    const existing = byType.get(row.type);
    if (!existing || (existing.audience === "COMMON" && row.audience !== "COMMON")) {
      byType.set(row.type, row);
    }
  }
  const eligibleRows = [...byType.values()].sort((a, b) => a.position - b.position);

  const sections: HomepageSectionModel[] = [];

  for (const row of eligibleRows) {
    switch (row.type) {
      // HERO_BANNER intentionally unhandled: the hero banner carousel is no
      // longer part of the HomepageSection-driven model — see
      // getActiveHeroBanners below. A leftover HERO_BANNER row (from before
      // this change) is simply ignored, never reset/deleted.
      case "TRUST_STRIP":
        sections.push({ type: "TRUST_STRIP" });
        break;
      // COUPON_STRIP intentionally unhandled: the coupon banner carousel is
      // no longer part of the HomepageSection-driven model — see
      // getActiveCouponBanners below. A leftover COUPON_STRIP row (from
      // before this change) is simply ignored, never reset/deleted.
      // TOP_CATEGORIES and PRODUCT_DISCOVERY_* intentionally unhandled —
      // both are now independent of HomepageSection, same reasoning as
      // HERO_BANNER above. See ShopByCategory (apps/web) for the former
      // and getManualHomepageProducts below for the latter.
      case "DEAL_OF_THE_DAY": {
        const deals = await getActiveDeals(viewer.audience, dealerStateId);
        if (deals.length > 0) sections.push({ type: "DEAL_OF_THE_DAY", deals });
        break;
      }
      case "JOIN_DEALER_SELLER": {
        const [dealerAssets, sellerAssets] = await Promise.all([
          getEligiblePromotionalAssets("JOIN_DEALER", viewer.audience),
          getEligiblePromotionalAssets("JOIN_SELLER", viewer.audience),
        ]);
        const dealerAsset = dealerAssets[0] ?? null;
        const sellerAsset = sellerAssets[0] ?? null;
        if (dealerAsset || sellerAsset)
          sections.push({ type: "JOIN_DEALER_SELLER", dealerAsset, sellerAsset });
        break;
      }
      case "FEATURED_BY_CATEGORY": {
        const groups = await resolveFeaturedByCategory(viewer.audience, dealerStateId);
        if (groups.length > 0) sections.push({ type: "FEATURED_BY_CATEGORY", groups });
        break;
      }
      // SHOP_BY_BRAND intentionally unhandled: it now sits in a fixed
      // position directly below the banner carousel on both apps/web and
      // the mobile app, independent of HomepageSection — same reasoning as
      // HERO_BANNER/TOP_CATEGORIES above. See getActiveShopByBrand.
    }
  }

  return { sections };
}

/**
 * The homepage banner carousel's data source — deliberately independent of
 * getHomepageModel/HomepageSection: the old flow needed an admin to both
 * enable a HERO_BANNER HomepageSection row AND maintain PromotionalAsset
 * rows for it, for one visual carousel. This reuses the exact same
 * eligibility rule (isActive, audience, in-schedule-window) via
 * getEligiblePromotionalAssets, ordered by priority (display order), so a
 * banner is live as soon as it's saved active in the admin — no separate
 * section toggle to remember.
 */
export async function getActiveHeroBanners(
  audience: HomepageViewerAudience,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  // Homepage redesign #2 — the home page shows only banners NOT tied to a
  // category ("Home page / All" in the admin dropdown); category-tied
  // banners appear on their own category page via getCategoryHeroBanners.
  return getEligiblePromotionalAssets("HERO", audience, false, null, language);
}

/** Homepage redesign #4 — the hero carousel for one category's page: HERO banners whose "Belongs to" is this exact category. */
export async function getCategoryHeroBanners(
  audience: HomepageViewerAudience,
  categoryId: string,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  return getEligiblePromotionalAssets("HERO", audience, false, categoryId, language);
}

/**
 * The homepage coupon banner carousel's data source — same reasoning and
 * shape as getActiveHeroBanners above, just placement="COUPON": rendered in
 * a fixed position directly below the hero banner carousel on both apps/web
 * and the mobile app, independent of getHomepageModel/HomepageSection. This
 * replaces the old COUPON_STRIP HomepageSection case, which only ever
 * rendered a single static image rather than a carousel.
 */
export async function getActiveCouponBanners(
  audience: HomepageViewerAudience,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  return getEligiblePromotionalAssets("COUPON", audience, false, null, language);
}

/**
 * The homepage's SECOND banner carousel — same shape/behaviour as the hero
 * (getActiveHeroBanners), a separate placement so the admin manages it as
 * its own list. Rendered further down the homepage (after Best Sellers).
 */
export async function getActiveSecondaryBanners(
  audience: HomepageViewerAudience,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  return getEligiblePromotionalAssets("HERO_SECONDARY", audience, false, null, language);
}

/**
 * One product row per active top-level category for the homepage's
 * "all categories" block. A category's row is its FEATURED_BY_CATEGORY
 * rank list (in rank order) when it has one; otherwise 10 random
 * in-catalogue products. Categories with no eligible products are omitted.
 */
export async function getHomepageCategoryRows(viewer: HomepageViewer) {
  const dealerStateId = viewer.dealerStateId ?? null;
  const audience = viewer.audience;

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  const audiences =
    audience === "CUSTOMER"
      ? ["CUSTOMER_ONLY", "BOTH_CUSTOMER_AND_DEALER"]
      : ["DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"];

  const groups: Array<{
    category: { id: string; name: string; slug: string };
    products: HomepageProduct[];
  }> = [];

  for (const category of categories) {
    const rankedItems = await prisma.merchandisingItem.findMany({
      where: { collection: { type: "FEATURED_BY_CATEGORY", categoryId: category.id } },
      orderBy: { position: "asc" },
      take: 10,
      select: { productId: true },
    });
    let ids = rankedItems.map((i) => i.productId);

    if (ids.length === 0) {
      // Prisma.raw()'d column name deliberately avoided here — Prisma 7's
      // WASM query compiler serializes a Prisma.raw() fragment spliced
      // into $queryRaw as a bound parameter instead of inlining it as SQL
      // text, producing "invalid input syntax for type boolean". Branching
      // on audience keeps the column name a template literal instead.
      const random =
        audience === "CUSTOMER"
          ? await prisma.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Product"
              WHERE "categoryId" = ${category.id}
                AND "lifecycleStatus" = 'APPROVED'
                AND "customerVisible" = true
                AND "audience"::text = ANY(${audiences})
              ORDER BY random() LIMIT 10`
          : await prisma.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Product"
              WHERE "categoryId" = ${category.id}
                AND "lifecycleStatus" = 'APPROVED'
                AND "dealerVisible" = true
                AND "audience"::text = ANY(${audiences})
              ORDER BY random() LIMIT 10`;
      ids = random.map((r) => r.id);
    }
    if (ids.length === 0) continue;

    const resolved = await resolveProductsByIds(ids, audience, dealerStateId);
    const ordered = orderByIds(ids, resolved);
    if (ordered.length > 0) groups.push({ category, products: ordered });
  }

  return groups;
}

/**
 * One product row per active subcategory for the homepage's "Shop by
 * Subcategory" block — same shape/logic as getHomepageCategoryRows just one
 * level down: FEATURED_BY_SUBCATEGORY rank list (up to 12, per product
 * spec) when a subcategory has one, else 12 random in-catalogue products.
 * Subcategories reuse their existing `position` field (already used to
 * order them within their parent category's admin list) for this row's
 * display order — no separate homepage-position field needed.
 */
export async function getHomepageSubcategoryRows(viewer: HomepageViewer) {
  const dealerStateId = viewer.dealerStateId ?? null;
  const audience = viewer.audience;

  const subcategories = await prisma.subcategory.findMany({
    where: { isActive: true, category: { isActive: true } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, category: { select: { slug: true } } },
  });

  const audiences =
    audience === "CUSTOMER"
      ? ["CUSTOMER_ONLY", "BOTH_CUSTOMER_AND_DEALER"]
      : ["DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"];

  const groups: Array<{
    subCategory: { id: string; name: string; slug: string; categorySlug: string };
    products: HomepageProduct[];
  }> = [];

  for (const subCategory of subcategories) {
    const rankedItems = await prisma.merchandisingItem.findMany({
      where: { collection: { type: "FEATURED_BY_SUBCATEGORY", subCategoryId: subCategory.id } },
      orderBy: { position: "asc" },
      take: 12,
      select: { productId: true },
    });
    let ids = rankedItems.map((i) => i.productId);

    if (ids.length === 0) {
      // See matching comment in getHomepageCategoryRows above — Prisma.raw()
      // spliced into $queryRaw is broken under Prisma 7's WASM query
      // compiler, so branch on audience instead of a raw column name.
      const random =
        audience === "CUSTOMER"
          ? await prisma.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Product"
              WHERE "subCategoryId" = ${subCategory.id}
                AND "lifecycleStatus" = 'APPROVED'
                AND "customerVisible" = true
                AND "audience"::text = ANY(${audiences})
              ORDER BY random() LIMIT 12`
          : await prisma.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Product"
              WHERE "subCategoryId" = ${subCategory.id}
                AND "lifecycleStatus" = 'APPROVED'
                AND "dealerVisible" = true
                AND "audience"::text = ANY(${audiences})
              ORDER BY random() LIMIT 12`;
      ids = random.map((r) => r.id);
    }
    if (ids.length === 0) continue;

    const resolved = await resolveProductsByIds(ids, audience, dealerStateId);
    const ordered = orderByIds(ids, resolved);
    if (ordered.length > 0) {
      groups.push({
        subCategory: {
          id: subCategory.id,
          name: subCategory.name,
          slug: subCategory.slug,
          categorySlug: subCategory.category.slug,
        },
        products: ordered,
      });
    }
  }

  return groups;
}

/**
 * Trending / Best Sellers / New Arrivals — manually curated only (see
 * packages/catalog/src/product-placement.ts's doc comment for why and for
 * the admin-side write path). Deliberately no automatic fallback: an
 * empty or all-ineligible selection returns an empty array, which the
 * caller renders as "section absent," never mock scores, view/sales
 * counts, or createdAt-based ranking.
 *
 * TODO(organic-ranking): once there's enough real traffic data, this can
 * gain a ranked/automatic mode the same way DEAL_OF_THE_DAY or
 * FEATURED_BY_CATEGORY might later — not building that framework now.
 */
export async function getManualHomepageProducts(
  type: MerchandisingType,
  viewer: HomepageViewer,
  limit = 10,
) {
  const collection = await prisma.merchandisingCollection.findFirst({
    where: { type, categoryId: null },
    include: { items: { orderBy: { position: "asc" }, take: limit } },
  });
  if (!collection || collection.items.length === 0) return [];

  const ids = collection.items.map((i) => i.productId);
  const resolved = await resolveProductsByIds(ids, viewer.audience, viewer.dealerStateId ?? null);
  return orderByIds(ids, resolved);
}
