import { prisma, Prisma, ProductLifecycleStatus, ProductAudience } from "@kisan4u/db";
import { isProductAvailableForState } from "./availability";
import { getCategoryRankedProductIds } from "./product-placement";
import { computeStockStatus } from "./inventory";

// Exported (not just module-local) so packages/catalog/src/homepage.ts's
// AUTOMATIC merchandising queries reuse the exact same eligibility gates
// instead of re-deriving them — see that file's doc comment.
export const CUSTOMER_AUDIENCES: ProductAudience[] = ["CUSTOMER_ONLY", "BOTH_CUSTOMER_AND_DEALER"];
export const DEALER_AUDIENCES: ProductAudience[] = ["DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"];

/**
 * Everywhere a customer-visible product is read (catalogue list, detail
 * page), the same five conditions apply: approved, customer-visible,
 * audience includes customer, and (for the customer-specific data) present.
 * Centralized here so no page re-derives these rules ad hoc and drifts.
 */
export const CUSTOMER_VISIBLE_WHERE = {
  lifecycleStatus: "APPROVED" as const,
  customerVisible: true,
  audience: { in: CUSTOMER_AUDIENCES },
};

/** Same shape as CUSTOMER_VISIBLE_WHERE, dealer side — used by homepage.ts's AUTOMATIC dealer-audience merchandising queries. */
export const DEALER_VISIBLE_WHERE = {
  lifecycleStatus: "APPROVED" as const,
  dealerVisible: true,
  audience: { in: DEALER_AUDIENCES },
};

// Exported so homepage.ts's customer-audience merchandising sections reuse
// this exact include shape rather than re-deriving it.
export const CUSTOMER_INCLUDE = {
  category: true,
  subCategory: true,
  subSubCategory: true,
  brand: true,
  manufacturer: true,
  editorialBadge: { select: { name: true, tone: true, kind: true } },
  seller: { select: { shopName: true, slug: true } },
  images: { where: { isActive: true }, orderBy: { position: "asc" as const } },
  // Per-language description overrides (storefront i18n) — resolved against
  // the viewer's language by resolveProductContent (./product-content.ts).
  translations: true,
  customerConfig: true,
  variants: {
    where: { audience: "CUSTOMER" as const, isActive: true },
    // Nests `attribute` (not just the bare attributeValue row) so a
    // variant label can be built as "Size: 500 ml" the same way the
    // dealer-side DEALER_PRICED_VARIANT_SELECT/DEALER_SAFE_VARIANT_SELECT
    // already do — previously these two audiences' variant shapes
    // disagreed on this, which the unified ProductCard adapter
    // (apps/web/src/lib/product-card-adapter.ts) needs to not have to
    // special-case.
    include: {
      values: { include: { attributeValue: { include: { attribute: true } } } },
      images: { where: { isActive: true }, orderBy: { position: "asc" as const } },
    },
  },
};

/**
 * Customer-account state-classified product gate, mirroring
 * `customerAvailableStates`'s "empty relation = Pan India / nationwide"
 * convention used everywhere else (licence-compliance.ts, the Dealer
 * catalogue). `stateId === undefined` means "don't filter at all" — used
 * by every caller that isn't a real customer-facing browsing session
 * (POS, admin previews, cross-audience "similar products" lookups) so
 * this stays purely additive and never changes those paths' behavior.
 * `stateId === null` means "an authenticated Customer who hasn't chosen a
 * state yet" — deliberately restricts them to nationwide-only products
 * rather than showing everything, so a state-classified product is never
 * reachable before the customer has told us where they are.
 */
export function customerStateAvailabilityWhere(
  stateId: string | null | undefined,
): Prisma.ProductWhereInput {
  if (stateId === undefined) return {};
  return {
    OR: [
      { customerAvailableStates: { none: {} } },
      ...(stateId ? [{ customerAvailableStates: { some: { id: stateId } } }] : []),
    ],
  };
}

export type CustomerCatalogueFilters = {
  categorySlug?: string;
  subCategorySlug?: string;
  subSubCategorySlug?: string;
  /** Homepage redesign, phase B — audience-aware crop / pest-&-disease landing pages. */
  cropSlug?: string;
  pestDiseaseSlug?: string;
  /** See customerStateAvailabilityWhere's doc comment for the undefined-vs-null distinction. */
  customerStateId?: string | null;
};

function customerCatalogueWhere(filters: CustomerCatalogueFilters): Prisma.ProductWhereInput {
  return {
    ...CUSTOMER_VISIBLE_WHERE,
    ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    ...(filters.subCategorySlug ? { subCategory: { slug: filters.subCategorySlug } } : {}),
    ...(filters.subSubCategorySlug
      ? { subSubCategory: { slug: filters.subSubCategorySlug } }
      : {}),
    ...(filters.cropSlug ? { crops: { some: { slug: filters.cropSlug } } } : {}),
    ...(filters.pestDiseaseSlug
      ? { pestsDiseases: { some: { slug: filters.pestDiseaseSlug } } }
      : {}),
    ...customerStateAvailabilityWhere(filters.customerStateId),
  };
}

export async function getCustomerCatalogue(filters: CustomerCatalogueFilters = {}) {
  return prisma.product.findMany({
    where: customerCatalogueWhere(filters),
    include: CUSTOMER_INCLUDE,
    orderBy: [{ featuredPosition: "asc" }, { createdAt: "desc" }],
  });
}

/**
 * The catalogue's default within-a-taxonomy sort once the category rank
 * list has been front-loaded: admin-set global featured position, then
 * most-recently-added.
 */
const CATALOGUE_REST_ORDER_BY: Prisma.ProductOrderByWithRelationInput[] = [
  { featuredPosition: "asc" },
  { createdAt: "desc" },
];

/**
 * The category page's product feed is "the up-to-10 category-ranked
 * products (in rank order), then every other product in the category".
 * This resolves the ranked id list — only for a bare top-level category
 * filter; a sub-category / sub-sub-category page (or a category with no
 * ranked products) gets the plain order.
 */
async function resolveCatalogueRankedIds(filters: {
  categorySlug?: string;
  subCategorySlug?: string;
  subSubCategorySlug?: string;
}): Promise<string[]> {
  if (!filters.categorySlug || filters.subCategorySlug || filters.subSubCategorySlug) return [];
  const category = await prisma.category.findUnique({
    where: { slug: filters.categorySlug },
    select: { id: true },
  });
  return category ? getCategoryRankedProductIds(category.id) : [];
}

/**
 * Slice of the "ranked block ++ everything else" virtual list for one
 * page: which ranked rows this page shows, and the skip/take into the
 * "rest" query for the remaining slots. Fully general over page size (the
 * ranked block can be any length); in practice the block is <=10 and the
 * page is larger, so it only ever appears on page 1.
 */
function catalogueRankSlice(page: number, pageSize: number, rankedCount: number) {
  const windowStart = (page - 1) * pageSize;
  const windowEnd = page * pageSize;
  const rankedFrom = Math.min(windowStart, rankedCount);
  const rankedTo = Math.min(windowEnd, rankedCount);
  return {
    rankedFrom,
    rankedTo,
    restSkip: Math.max(0, windowStart - rankedCount),
    restTake: pageSize - (rankedTo - rankedFrom),
  };
}

/**
 * One page of the customer catalogue for a taxonomy node — powers the
 * infinite-scroll product grid on the category / sub-category /
 * sub-sub-category pages. On a top-level category page the category rank
 * list is served first (in rank order), then the rest of the category by
 * featured position + recency; elsewhere it's just that order. Fetches
 * `restTake + 1` "rest" rows so the caller knows whether a next page
 * exists without a separate count query. `page` is 1-based.
 */
export async function getCustomerCataloguePage(
  filters: CustomerCatalogueFilters & { page: number; pageSize: number },
) {
  const page = Math.max(1, Math.trunc(filters.page));
  const pageSize = Math.min(60, Math.max(1, Math.trunc(filters.pageSize)));
  const where = customerCatalogueWhere(filters);

  const rankedIds = await resolveCatalogueRankedIds(filters);
  let orderedRanked: Prisma.ProductGetPayload<{ include: typeof CUSTOMER_INCLUDE }>[] = [];
  if (rankedIds.length > 0) {
    const visible = await prisma.product.findMany({
      where: { ...where, id: { in: rankedIds } },
      include: CUSTOMER_INCLUDE,
    });
    const byId = new Map(visible.map((p) => [p.id, p]));
    orderedRanked = rankedIds
      .map((id) => byId.get(id))
      .filter((p): p is (typeof visible)[number] => Boolean(p));
  }

  const { rankedFrom, rankedTo, restSkip, restTake } = catalogueRankSlice(
    page,
    pageSize,
    orderedRanked.length,
  );
  const pageRanked = orderedRanked.slice(rankedFrom, rankedTo);

  const restRaw = await prisma.product.findMany({
    where:
      orderedRanked.length > 0
        ? { ...where, id: { notIn: orderedRanked.map((p) => p.id) } }
        : where,
    include: CUSTOMER_INCLUDE,
    orderBy: CATALOGUE_REST_ORDER_BY,
    skip: restSkip,
    take: Math.max(1, restTake) + 1,
  });
  const hasMore = restRaw.length > restTake || rankedTo < orderedRanked.length;
  const restRows = restTake > 0 ? restRaw.slice(0, restTake) : [];

  return { rows: [...pageRanked, ...restRows], hasMore };
}

/** Public product detail — null if the slug doesn't resolve to a customer-visible approved product available in `customerStateId` (see customerStateAvailabilityWhere). */
export async function getPublicProductBySlug(slug: string, customerStateId?: string | null) {
  return prisma.product.findFirst({
    where: { slug, ...CUSTOMER_VISIBLE_WHERE, ...customerStateAvailabilityWhere(customerStateId) },
    include: CUSTOMER_INCLUDE,
  });
}

/** Same as getPublicProductBySlug, by id instead of slug — POS's product modal (spec §12) opens from a catalogue-grid card, which already has the id, not the slug. POS never passes customerStateId (see customerStateAvailabilityWhere), so this is unchanged for that caller. */
export async function getCustomerProductById(id: string, customerStateId?: string | null) {
  return prisma.product.findFirst({
    where: { id, ...CUSTOMER_VISIBLE_WHERE, ...customerStateAvailabilityWhere(customerStateId) },
    include: CUSTOMER_INCLUDE,
  });
}

/**
 * Deliberately minimal — id + dealer-audience flags only, NO pricing/config
 * fields at all. Used exclusively by the customer product page's
 * dealer-redirect check (apps/web/src/app/products/[slug]/page.tsx): a
 * signed-in dealer must never reach customer pricing, so the redirect
 * decision has to be made from a query that couldn't leak it even if the
 * page's own rendering logic had a bug — see CUSTOMER_INCLUDE above, which
 * this intentionally does NOT use.
 */
export async function getProductAudienceInfoBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { slug, lifecycleStatus: "APPROVED" },
    select: { id: true, dealerVisible: true, audience: true },
  });
}

const NAME_TRANSLATIONS_SELECT = {
  select: { language: true, name: true, description: true },
} as const;

export async function getCategoryBySlug(slug: string) {
  return prisma.category.findFirst({
    where: { slug, isActive: true },
    include: { translations: NAME_TRANSLATIONS_SELECT },
  });
}

/** Active sub-category by slug, with its parent category — for the sub-category page. */
export async function getSubcategoryBySlug(slug: string) {
  return prisma.subcategory.findFirst({
    where: { slug, isActive: true },
    include: {
      translations: NAME_TRANSLATIONS_SELECT,
      category: {
        select: { id: true, name: true, slug: true, translations: NAME_TRANSLATIONS_SELECT },
      },
    },
  });
}

/** Active sub-sub-category by slug, with its parent chain — for the sub-sub-category page. */
export async function getSubSubCategoryBySlug(slug: string) {
  return prisma.subSubCategory.findFirst({
    where: { slug, isActive: true },
    include: {
      translations: NAME_TRANSLATIONS_SELECT,
      subCategory: {
        select: {
          id: true,
          name: true,
          slug: true,
          translations: NAME_TRANSLATIONS_SELECT,
          category: {
            select: { id: true, name: true, slug: true, translations: NAME_TRANSLATIONS_SELECT },
          },
        },
      },
    },
  });
}

/**
 * Full active category → subcategory → sub-subcategory tree for the
 * site-wide category navigation bar (mega menu + mobile drawer). A single
 * query with nested `select` — Prisma compiles this to joins, not N+1 —
 * ordered by `position` at every level, inactive rows excluded at every
 * level so a deactivated subcategory/sub-subcategory can't leave an
 * orphaned link under an active parent.
 */
export async function getCategoryNavTree() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      emoji: true,
      translations: NAME_TRANSLATIONS_SELECT,
      subCategories: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          translations: NAME_TRANSLATIONS_SELECT,
          subSubCategories: {
            where: { isActive: true },
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              slug: true,
              imageUrl: true,
              translations: NAME_TRANSLATIONS_SELECT,
            },
          },
        },
      },
    },
  });
}
export type CategoryNavTree = Awaited<ReturnType<typeof getCategoryNavTree>>;

/**
 * Lean read for the "Shop by Category" homepage section — top-level
 * categories only (no subcategory/sub-subcategory join, unlike
 * getCategoryNavTree above, since the cards don't need them), ordered by
 * the same Category.position the admin sets from /admin/categories and
 * the category nav bar already sorts by.
 */
export async function getActiveTopLevelCategoriesForHomepage() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      translations: NAME_TRANSLATIONS_SELECT,
    },
  });
}

/**
 * Every field a dealer-facing read is allowed to touch on
 * ProductDealerConfig/ProductVariant — deliberately a `select`, not
 * `include`, and deliberately excludes mrp/sellingPrice/discountType/
 * discountValue/taxPercent/shippingCost. Dealer pricing must never reach
 * a dealer-facing page's props at all (see requirement: "do not fetch
 * sensitive dealer-price fields into public/client components if they
 * are not needed") — a UI-layer omission alone isn't enough, since the
 * data would still be sitting in the serialized page payload for anyone
 * to read from view-source.
 */
/**
 * Every field a dealer-facing read is allowed to touch on
 * ProductDealerConfig/ProductVariant, INCLUDING price
 * (mrp/sellingPrice) — see the doc comment on DEALER_CATALOGUE_SELECT
 * below for why this changed from the original price-free design.
 * Deliberately still a `select`, not `include` — still excludes
 * discountType/discountValue/taxPercent/shippingCost, which the card
 * never needs (sellingPrice is already server-computed net of discount).
 */
const DEALER_PRICED_CONFIG_SELECT = {
  minOrderQty: true,
  currentStock: true,
  weight: true,
  mrp: true,
  sellingPrice: true,
  loyaltyPoints: true,
} as const;
const DEALER_PRICED_VARIANT_SELECT = {
  id: true,
  sku: true,
  minOrderQty: true,
  stockQty: true,
  weight: true,
  imageUrl: true,
  imageAlt: true,
  videoUrl: true,
  images: {
    where: { isActive: true },
    orderBy: { position: "asc" as const },
    select: { id: true, url: true, altText: true },
  },
  isActive: true,
  isDefault: true,
  mrp: true,
  sellingPrice: true,
  loyaltyPoints: true,
  values: {
    select: {
      attributeValue: {
        select: { id: true, value: true, attributeId: true, attribute: { select: { name: true } } },
      },
    },
  },
} as const;

/**
 * Exported so packages/catalog/src/homepage.ts's dealer-audience
 * merchandising sections (Trending/Best Sellers/New Arrivals/Featured by
 * Category) return the exact same shape as the dealer catalogue grid —
 * one adapter in apps/web then handles both without a second dealer-shape
 * variant to keep in sync.
 *
 * Conflict resolution, documented explicitly: this used to be
 * deliberately price-free (a prior requirement: "dealer pricing must
 * never reach a dealer-facing page's props if not needed" — because price
 * was only meaningful after a per-product eligibility check on the detail
 * page). The Product Card Design Spec's dealer card now explicitly
 * requires "Show dealer pricing" directly on the browse-grid card, which
 * supersedes that "not needed" premise for the case where the product IS
 * purchasable. Resolution: price fields ARE fetched here now, but
 * `packages/../apps/web/src/lib/product-card-adapter.ts` is the
 * enforcement point that only ever places them into the card's rendered
 * props when `availableInState` is true — a product a dealer cannot buy
 * (Request-Seller-only) never gets a price in its adapted output, keeping
 * the original security intent for exactly the case it existed to
 * protect.
 */
export const DEALER_CATALOGUE_SELECT = {
  id: true,
  name: true,
  slug: true,
  subtitle: true,
  editorialBadge: { select: { name: true, tone: true, kind: true } },
  deliveryBadgeEnabled: true,
  deliveryBadgeText: true,
  availabilityBadgeMode: true,
  availabilityBadgeText: true,
  ratingAverage: true,
  ratingCount: true,
  primaryImageUrl: true,
  category: { select: { id: true, name: true, slug: true } },
  // slug added alongside the pre-existing id/name so the dealer products
  // route can filter by subcategory (mobile Shop screen parity with the
  // customer catalogue's subCategorySlug filter) without a second query.
  subCategory: { select: { id: true, name: true, slug: true } },
  // slug added alongside subCategory's, same reasoning — lets the dealer
  // products route filter by sub-subcategory too.
  subSubCategory: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  manufacturer: { select: { id: true, name: true } },
  dealerAvailableStates: { select: { id: true } },
  // Per-language display name only (i18n) — resolveProductName picks the
  // viewer's language, English name is the fallback.
  translations: { select: { language: true, name: true } },
  images: {
    where: { isActive: true },
    orderBy: { position: "asc" as const },
    select: { id: true, url: true, altText: true },
  },
  dealerConfig: { select: DEALER_PRICED_CONFIG_SELECT },
  variants: {
    where: { audience: "DEALER" as const, isActive: true },
    select: DEALER_PRICED_VARIANT_SELECT,
  },
  featuredPosition: true,
  createdAt: true,
} as const;

/**
 * Dealer catalogue — caller must already have verified the dealer's
 * session is authenticated and their DealerProfile.status is APPROVED
 * (see apps/web/src/lib/session-guard.ts + getDealerProfileForUser) before
 * calling this; it does not re-check dealer identity itself, only product
 * visibility + state availability. A product with zero `dealerAvailableStates`
 * rows is treated as available nationwide (unrestricted); one with at
 * least one row is restricted to exactly those states.
 *
 * Corrective fix for the unified Product Card (Product Card Design Spec
 * §Dealer Card): previously filtered out state-unavailable products
 * entirely, so a dealer never saw them at all. The card now needs to show
 * those products too, with a Request-Seller-only action instead of Add to
 * Cart/Buy Now — so this returns every dealer-eligible product with an
 * `availableInState` flag (mirroring getDealerProductDetail below) instead
 * of omitting the unavailable ones.
 */
export async function getDealerCatalogue(
  dealerStateId: string | null,
  filters: { cropSlug?: string; pestDiseaseSlug?: string } = {},
) {
  const products = await prisma.product.findMany({
    where: {
      lifecycleStatus: "APPROVED",
      dealerVisible: true,
      audience: { in: DEALER_AUDIENCES },
      ...(filters.cropSlug ? { crops: { some: { slug: filters.cropSlug } } } : {}),
      ...(filters.pestDiseaseSlug
        ? { pestsDiseases: { some: { slug: filters.pestDiseaseSlug } } }
        : {}),
    },
    select: DEALER_CATALOGUE_SELECT,
    orderBy: [{ featuredPosition: "asc" }, { createdAt: "desc" }],
  });

  return products.map((p) => ({
    ...p,
    availableInState: isProductAvailableForState(p.dealerAvailableStates, dealerStateId),
  }));
}

/**
 * One page of the dealer catalogue for a taxonomy node — the dealer-side
 * counterpart of getCustomerCataloguePage, powering the infinite-scroll
 * grid on the category / sub-category / sub-sub-category pages for an
 * APPROVED dealer viewer. Same `pageSize + 1` "has next page" trick.
 * Caller must already have verified the dealer is authenticated + APPROVED
 * (same contract as getDealerCatalogue).
 */
export async function getDealerCataloguePage(filters: {
  categorySlug?: string;
  subCategorySlug?: string;
  subSubCategorySlug?: string;
  dealerStateId: string | null;
  page: number;
  pageSize: number;
}) {
  const page = Math.max(1, Math.trunc(filters.page));
  const pageSize = Math.min(60, Math.max(1, Math.trunc(filters.pageSize)));
  const where: Prisma.ProductWhereInput = {
    lifecycleStatus: "APPROVED",
    dealerVisible: true,
    audience: { in: DEALER_AUDIENCES },
    ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    ...(filters.subCategorySlug ? { subCategory: { slug: filters.subCategorySlug } } : {}),
    ...(filters.subSubCategorySlug
      ? { subSubCategory: { slug: filters.subSubCategorySlug } }
      : {}),
  };
  const withState = <T extends { dealerAvailableStates: { id: string }[] }>(p: T) => ({
    ...p,
    availableInState: isProductAvailableForState(p.dealerAvailableStates, filters.dealerStateId),
  });

  const rankedIds = await resolveCatalogueRankedIds(filters);
  let orderedRanked: Prisma.ProductGetPayload<{ select: typeof DEALER_CATALOGUE_SELECT }>[] = [];
  if (rankedIds.length > 0) {
    const visible = await prisma.product.findMany({
      where: { ...where, id: { in: rankedIds } },
      select: DEALER_CATALOGUE_SELECT,
    });
    const byId = new Map(visible.map((p) => [p.id, p]));
    orderedRanked = rankedIds
      .map((id) => byId.get(id))
      .filter((p): p is (typeof visible)[number] => Boolean(p));
  }

  const { rankedFrom, rankedTo, restSkip, restTake } = catalogueRankSlice(
    page,
    pageSize,
    orderedRanked.length,
  );
  const pageRanked = orderedRanked.slice(rankedFrom, rankedTo);

  const restRaw = await prisma.product.findMany({
    where:
      orderedRanked.length > 0
        ? { ...where, id: { notIn: orderedRanked.map((p) => p.id) } }
        : where,
    select: DEALER_CATALOGUE_SELECT,
    orderBy: CATALOGUE_REST_ORDER_BY,
    skip: restSkip,
    take: Math.max(1, restTake) + 1,
  });
  const restRows = restTake > 0 ? restRaw.slice(0, restTake) : [];

  return {
    rows: [...pageRanked, ...restRows].map(withState),
    hasMore: restRaw.length > restTake || rankedTo < orderedRanked.length,
  };
}

export type PosCatalogueFilters = {
  categorySlug?: string;
  brandId?: string;
  /** Matches product name, product SKU, or any of its variants' SKUs (spec §11's POS search box). */
  search?: string;
  page?: number;
  pageSize?: number;
};

export type PosCatalogueResult<T> = { rows: T[]; total: number; page: number; pageSize: number };

function posCataloguePaging(filters: Pick<PosCatalogueFilters, "page" | "pageSize">) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 24));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function posCatalogueSearchWhere(search: string | undefined): Prisma.ProductWhereInput {
  const q = search?.trim();
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
    ],
  };
}

/**
 * POS's own paginated/searchable customer catalogue (spec §11/§2) — reuses
 * CUSTOMER_VISIBLE_WHERE and CUSTOMER_INCLUDE unchanged (same eligibility gate
 * and shape as getCustomerCatalogue/getPublicProductBySlug, so POS and the
 * storefront can never disagree about what's customer-visible or what a
 * product looks like), adding only search + pagination on top. Returns
 * `{rows, total, page, pageSize}` — the same paginated-listing shape
 * already used elsewhere (getAllProductRequestsForAdmin,
 * getSellerProductsPaginated) — rather than changing getCustomerCatalogue's
 * own return shape, which 8 existing call sites depend on staying a plain
 * array.
 */
export async function searchCustomerCatalogueForPos(filters: PosCatalogueFilters = {}) {
  const { page, pageSize, skip, take } = posCataloguePaging(filters);
  const where: Prisma.ProductWhereInput = {
    ...CUSTOMER_VISIBLE_WHERE,
    ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...posCatalogueSearchWhere(filters.search),
  };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: CUSTOMER_INCLUDE,
      orderBy: [{ featuredPosition: "asc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.product.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

/**
 * POS's own paginated/searchable dealer catalogue — same DEALER_AUDIENCES/
 * dealerVisible gate and DEALER_CATALOGUE_SELECT shape as getDealerCatalogue
 * (so pricing/eligibility fields are identical to the storefront's dealer
 * grid), plus search + pagination + `availableInState` computed the same
 * way. `availableOnly` filters to only state-available, in-stock rows
 * (spec §11 "Show only available" switch) — applied AFTER availableInState
 * is computed, never by narrowing the query in a way that would also hide
 * a wrong-audience/wrong-catalogue product (that's still governed entirely
 * by DEALER_AUDIENCES/dealerVisible above, never by this flag).
 */
export async function searchDealerCatalogueForPos(
  dealerStateId: string | null,
  filters: PosCatalogueFilters & { availableOnly?: boolean } = {},
) {
  const { page, pageSize, skip, take } = posCataloguePaging(filters);
  const where: Prisma.ProductWhereInput = {
    lifecycleStatus: "APPROVED",
    dealerVisible: true,
    audience: { in: DEALER_AUDIENCES },
    ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...posCatalogueSearchWhere(filters.search),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: DEALER_CATALOGUE_SELECT,
      orderBy: [{ featuredPosition: "asc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.product.count({ where }),
  ]);

  const withAvailability = rows.map((p) => ({
    ...p,
    availableInState: isProductAvailableForState(p.dealerAvailableStates, dealerStateId),
  }));

  if (!filters.availableOnly) return { rows: withAvailability, total, page, pageSize };

  const availableRows = withAvailability.filter(
    (p) =>
      p.availableInState &&
      (p.variants.length > 0
        ? p.variants.some((v) => v.isActive && v.stockQty > 0)
        : (p.dealerConfig?.currentStock ?? 0) > 0),
  );
  // Known, accepted limitation: `availableOnly` filters AFTER pagination,
  // so a page can come back with fewer than `pageSize` rows once
  // unavailable ones are dropped (`total` still reflects the full,
  // pre-filter catalogue-eligible count, for correct page-count math
  // against the unfiltered query — not the number of rows actually
  // returned on this page). Re-querying to always fill a full page of
  // available-only rows would need a second DB-side availability
  // predicate (SQL can't easily express isProductAvailableForState's JS
  // logic) — not attempted here since the existing storefront dealer grid
  // has the same "availability is a post-query JS computation" shape and
  // isn't paginated at all today, so there's no prior art to match either
  // way; this is POS's own new tradeoff, not a regression from anything.
  return { rows: availableRows, total, page, pageSize };
}

/**
 * Single-product dealer detail — same shape as getDealerCatalogue, plus
 * sellerId, the additional images/video, and (corrective fix) the
 * dealer's own price fields and an `availableInState` flag. Unlike
 * getDealerCatalogue's list view, this NO LONGER returns null for a
 * product that's simply unavailable in the dealer's state — the dealer
 * product-detail page needs to render that case too, with a "Request
 * Seller" action instead of Add to Cart (see requirement: "Request Seller
 * should be shown specifically when the product is not currently
 * available in the dealer's state," which is unreachable if the query
 * layer 404s the page first). It still returns null for a product that
 * fails the dealer-audience/visibility/lifecycle gate entirely — those
 * conditions mean this is not a dealer product at all, not "unavailable
 * right now."
 */
export async function getDealerProductDetail(productId: string, dealerStateId: string | null) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      lifecycleStatus: "APPROVED",
      dealerVisible: true,
      audience: { in: DEALER_AUDIENCES },
    },
    select: {
      id: true,
      sellerId: true,
      seller: { select: { shopName: true } },
      name: true,
      slug: true,
      subtitle: true,
      editorialBadge: { select: { name: true, tone: true, kind: true } },
      deliveryBadgeEnabled: true,
      deliveryBadgeText: true,
      availabilityBadgeMode: true,
      availabilityBadgeText: true,
      ratingAverage: true,
      ratingCount: true,
      shortDescription: true,
      description: true,
      ingredients: true,
      howToUse: true,
      dosageInstructions: true,
      technicalInfo: true,
      translations: {
        select: {
          language: true,
          shortDescription: true,
          description: true,
          ingredients: true,
          howToUse: true,
          dosageInstructions: true,
          technicalInfo: true,
        },
      },
      primaryImageUrl: true,
      videoUrl: true,
      category: { select: { id: true, name: true, slug: true } },
      subCategory: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true, slug: true } },
      manufacturer: { select: { id: true, name: true } },
      dealerAvailableStates: { select: { id: true } },
      images: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        select: { id: true, url: true, altText: true },
      },
      dealerConfig: { select: DEALER_PRICED_CONFIG_SELECT },
      variants: {
        where: { audience: "DEALER", isActive: true },
        select: DEALER_PRICED_VARIANT_SELECT,
      },
    },
  });
  if (!product) return null;
  return {
    ...product,
    availableInState: isProductAvailableForState(product.dealerAvailableStates, dealerStateId),
  };
}

/** All products owned by a seller, any lifecycle status, for their own list view. */
export async function getSellerProducts(sellerId: string) {
  return prisma.product.findMany({
    where: { sellerId },
    include: { category: true, customerConfig: true, dealerConfig: true },
    orderBy: { updatedAt: "desc" },
  });
}

export type SellerProductSortKey = "name" | "category" | "status" | "createdAt" | "updatedAt";

/** Whitelisted — never pass a raw query-string value straight into `orderBy`. Same shape as ADMIN_PRODUCT_SORT below, scoped to the sort keys the seller products table offers. */
const SELLER_PRODUCT_SORT: Record<
  SellerProductSortKey,
  (dir: "asc" | "desc") => Prisma.ProductOrderByWithRelationInput
> = {
  name: (dir) => ({ name: dir }),
  category: (dir) => ({ category: { name: dir } }),
  status: (dir) => ({ lifecycleStatus: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
};

export type SellerProductFilters = {
  status?: ProductLifecycleStatus;
  categoryId?: string;
  q?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

/**
 * Paginated/searchable/filterable/sortable sibling of getSellerProducts
 * above — added for the seller products table (AdminDataTable server
 * mode) without changing that function's signature, since it's also used
 * by apps/web's mobile API route and apps/mobile, neither of which need
 * pagination. Mirrors getAdminProductQueue's shape below, scoped to a
 * single seller instead of the admin's global queue.
 */
export async function getSellerProductsPaginated(
  sellerId: string,
  filters: SellerProductFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const sortField =
    filters.sortKey && filters.sortKey in SELLER_PRODUCT_SORT
      ? SELLER_PRODUCT_SORT[filters.sortKey as SellerProductSortKey](sortDir)
      : { updatedAt: sortDir };

  const q = filters.q?.trim();
  const where: Prisma.ProductWhereInput = {
    sellerId,
    ...(filters.status ? { lifecycleStatus: filters.status } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { sku: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: true,
        customerConfig: true,
        dealerConfig: true,
        // For the list "Price" column: a variant product's base config
        // holds no real price, so the row falls back to the span of
        // variant selling prices — see productPriceRange in the dashboard.
        variants: { select: { sellingPrice: true } },
      },
      orderBy: sortField,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type ProductCatalogueSummary = {
  total: number;
  live: number;
  pending: number;
  draft: number;
  rejected: number;
  stockAttentionCount: number;
};

/**
 * Powers the Products list's stat cards + quick-tab counts — counts
 * across the WHOLE catalogue, same convention as the other admin list
 * summaries (getDealerApplicationsSummary etc). Deliberately excludes a
 * "not positioned" count: that requires the trending/best-seller/new-
 * arrival/category-rank placement maps admin/products/page.tsx already
 * fetches in full (getProductPlacementsMap/getProductCategoryRankMap) —
 * the page combines those with `total` itself rather than this function
 * re-deriving the same placement logic a second time.
 */
export async function getProductCatalogueSummary(): Promise<ProductCatalogueSummary> {
  const [total, live, pending, draft, rejected, stockAttentionIds] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { lifecycleStatus: "APPROVED" } }),
    prisma.product.count({ where: { lifecycleStatus: "SUBMITTED" } }),
    prisma.product.count({ where: { lifecycleStatus: "DRAFT" } }),
    prisma.product.count({ where: { lifecycleStatus: "REJECTED" } }),
    getProductIdsWithStockAttention(),
  ]);
  return { total, live, pending, draft, rejected, stockAttentionCount: stockAttentionIds.size };
}

const FULL_PRODUCT_INCLUDE = {
  category: true,
  subCategory: true,
  subSubCategory: true,
  brand: true,
  manufacturer: true,
  customerAvailableStates: true,
  dealerAvailableStates: true,
  crops: { select: { id: true } },
  pestsDiseases: { select: { id: true } },
  images: { orderBy: { position: "asc" as const } },
  translations: true,
  customerConfig: true,
  dealerConfig: true,
  variants: {
    include: {
      values: { include: { attributeValue: true } },
      images: { orderBy: { position: "asc" as const } },
    },
  },
  variantAttributeValues: {
    orderBy: [{ attributeId: "asc" as const }, { position: "asc" as const }],
    include: { attribute: true },
  },
  seller: { select: { id: true, shopName: true } },
};

/** Full detail for the seller's own edit form — caller must call assertOwnsProduct() first. */
export async function getProductForSellerEdit(productId: string) {
  return prisma.product.findUnique({ where: { id: productId }, include: FULL_PRODUCT_INCLUDE });
}

/** Full detail for the admin review page — includes both customer and dealer data, all variants, and the submitting seller. */
export async function getProductForAdmin(productId: string) {
  return prisma.product.findUnique({ where: { id: productId }, include: FULL_PRODUCT_INCLUDE });
}

export type AdminProductSortKey =
  "name" | "category" | "status" | "featuredPosition" | "createdAt" | "updatedAt";

/** Whitelisted — never pass a raw query-string value straight into `orderBy`. Relation sort (category) is a valid Prisma `orderBy` shape, not a raw string. */
const ADMIN_PRODUCT_SORT: Record<
  AdminProductSortKey,
  (dir: "asc" | "desc") => Prisma.ProductOrderByWithRelationInput
> = {
  name: (dir) => ({ name: dir }),
  category: (dir) => ({ category: { name: dir } }),
  status: (dir) => ({ lifecycleStatus: dir }),
  featuredPosition: (dir) => ({ featuredPosition: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
};

export type AdminProductFilters = {
  status?: ProductLifecycleStatus;
  categoryId?: string;
  audience?: ProductAudience;
  q?: string;
  /** Restricts to products with at least one tracked unit at REORDER_REQUIRED/MINIMUM_LEVEL/OUT_OF_STOCK — computed via getProductIdsWithStockAttention since stock status is a column-to-column comparison Prisma's `where` can't express. Mutually exclusive with a real use of `status` in practice (the "Stock Attention" quick tab is its own segment, not a lifecycle status). */
  stockAttention?: boolean;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

/** Every product with at least one tracked (variant or base-config) unit at REORDER_REQUIRED/MINIMUM_LEVEL/OUT_OF_STOCK — the Products page's "Stock Attention" quick tab and stat card. Deliberately platform-wide (no seller/category scoping) since the Products list doesn't otherwise take seller/category as a precondition the way the Inventory page does. */
export async function getProductIdsWithStockAttention(): Promise<Set<string>> {
  const [variants, customerConfigs, dealerConfigs] = await Promise.all([
    prisma.productVariant.findMany({
      select: { productId: true, stockQty: true, minStockQty: true, reorderLevel: true },
    }),
    prisma.productCustomerConfig.findMany({
      select: { productId: true, currentStock: true, minStockQty: true, reorderLevel: true },
    }),
    prisma.productDealerConfig.findMany({
      select: { productId: true, currentStock: true, minStockQty: true, reorderLevel: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const v of variants) {
    if (computeStockStatus(v.stockQty, v.minStockQty, v.reorderLevel).status !== "IN_STOCK") {
      ids.add(v.productId);
    }
  }
  for (const c of [...customerConfigs, ...dealerConfigs]) {
    if (computeStockStatus(c.currentStock, c.minStockQty, c.reorderLevel).status !== "IN_STOCK") {
      ids.add(c.productId);
    }
  }
  return ids;
}

export async function getAdminProductQueue(filters: AdminProductFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_PRODUCT_SORT
      ? ADMIN_PRODUCT_SORT[filters.sortKey as AdminProductSortKey](sortDir)
      : { updatedAt: sortDir };

  const q = filters.q?.trim();
  const stockAttentionIds = filters.stockAttention ? await getProductIdsWithStockAttention() : null;
  const where: Prisma.ProductWhereInput = {
    ...(filters.status ? { lifecycleStatus: filters.status } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.audience ? { audience: filters.audience } : {}),
    ...(stockAttentionIds ? { id: { in: [...stockAttentionIds] } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { seller: { shopName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: true,
        seller: { select: { id: true, shopName: true } },
        // "Price" column — see the matching include in
        // getSellerProductsPaginated and productPriceRange in the dashboard.
        customerConfig: {
          select: { sellingPrice: true, currentStock: true, minStockQty: true, reorderLevel: true },
        },
        dealerConfig: {
          select: { sellingPrice: true, currentStock: true, minStockQty: true, reorderLevel: true },
        },
        variants: {
          select: { sellingPrice: true, stockQty: true, minStockQty: true, reorderLevel: true },
        },
      },
      orderBy: sortField,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}
