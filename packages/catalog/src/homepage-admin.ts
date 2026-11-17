import { prisma } from "@kisan4u/db";
import type {
  HomepageSectionInput,
  PromotionalAssetInput,
  CategoryHomepageAssetInput,
  DealOfTheDayInput,
} from "@kisan4u/validators";

/**
 * Admin CRUD for the Homepage CMS models (Complete Design/Admin Spec
 * §11.1-§11.4). Each function's caller (apps/dashboard's Server Actions)
 * is responsible for requireSession(["ADMIN"]) — these functions
 * themselves stay auth-unaware, matching this codebase's existing
 * convention (e.g. packages/orders' admin-config.ts).
 */

// --- Homepage sections -----------------------------------------------------

export async function listHomepageSections() {
  return prisma.homepageSection.findMany({ orderBy: { position: "asc" } });
}

export async function saveHomepageSection(input: HomepageSectionInput) {
  return prisma.homepageSection.update({
    where: { id: input.id },
    data: {
      position: input.position,
      enabled: input.enabled,
      audience: input.audience,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
    },
  });
}

// --- Promotional assets (hero / coupon / join banners) --------------------

/**
 * `audience`, when given, scopes the list to an EXACT match — no `COMMON`
 * fallback. Per product decision, "common" is no longer a concept for the
 * admin Banners page's HERO/COUPON audience toggle: a banner meant for both
 * Customer and Dealer is now two individual rows, one per audience, not one
 * shared row (mirrors the identical `includeCommon=false` choice in
 * `getEligiblePromotionalAssets`, ./homepage.ts, which is what the
 * storefront itself reads).
 */
export async function listPromotionalAssets(
  placement?: "HERO" | "COUPON" | "HERO_SECONDARY" | "JOIN_DEALER" | "JOIN_SELLER",
  audience?: "CUSTOMER" | "DEALER",
  language?: "EN" | "HI" | "MR" | "TE" | "TA",
) {
  return prisma.promotionalAsset.findMany({
    where: {
      ...(placement ? { placement } : {}),
      ...(audience ? { audience } : {}),
      ...(language ? { language } : {}),
    },
    orderBy: [{ placement: "asc" }, { priority: "asc" }],
  });
}

export async function savePromotionalAsset(input: PromotionalAssetInput) {
  const data = {
    placement: input.placement,
    audience: input.audience,
    language: input.language ?? "EN",
    categoryId: input.categoryId || null,
    desktopImageUrl: input.desktopImageUrl,
    mobileImageUrl: input.mobileImageUrl || null,
    altText: input.altText,
    linkUrl: input.linkUrl || null,
    ctaLabel: input.ctaLabel || null,
    priority: input.priority,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    isActive: input.isActive,
  };
  if (input.id) return prisma.promotionalAsset.update({ where: { id: input.id }, data });
  return prisma.promotionalAsset.create({ data });
}

export async function deletePromotionalAsset(id: string) {
  await prisma.promotionalAsset.delete({ where: { id } });
}

// --- Top Categories (distinct homepage square image) ----------------------

export async function listCategoryHomepageAssets() {
  return prisma.categoryHomepageAsset.findMany({
    include: { category: { select: { id: true, name: true, slug: true } } },
    orderBy: { position: "asc" },
  });
}

export async function saveCategoryHomepageAsset(input: CategoryHomepageAssetInput) {
  const data = { imageUrl: input.imageUrl, position: input.position, isActive: input.isActive };
  if (input.id) return prisma.categoryHomepageAsset.update({ where: { id: input.id }, data });
  return prisma.categoryHomepageAsset.upsert({
    where: { categoryId: input.categoryId },
    update: data,
    create: { categoryId: input.categoryId, ...data },
  });
}

export async function deleteCategoryHomepageAsset(id: string) {
  await prisma.categoryHomepageAsset.delete({ where: { id } });
}

// --- Deal of the Day --------------------------------------------------------

export async function listDealsOfTheDay() {
  return prisma.dealOfTheDay.findMany({
    include: {
      product: { select: { id: true, name: true, slug: true } },
      variant: { select: { id: true, sku: true } },
    },
    orderBy: { startAt: "desc" },
  });
}

export async function saveDealOfTheDay(input: DealOfTheDayInput) {
  const data = {
    productId: input.productId,
    variantId: input.variantId || null,
    dealPrice: input.dealPrice,
    startAt: input.startAt,
    endAt: input.endAt,
    isActive: input.isActive,
  };
  if (input.id) return prisma.dealOfTheDay.update({ where: { id: input.id }, data });
  return prisma.dealOfTheDay.create({ data });
}

export async function deleteDealOfTheDay(id: string) {
  await prisma.dealOfTheDay.delete({ where: { id } });
}

// --- Product Discovery (Trending / Best Sellers / New Arrivals) -----------

export type DiscoveryType = "TRENDING" | "BEST_SELLERS" | "NEW_ARRIVALS";

export async function getDiscoveryCollection(type: DiscoveryType) {
  const existing = await prisma.merchandisingCollection.findFirst({
    where: { type, categoryId: null },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: { product: { select: { id: true, name: true, slug: true } } },
      },
    },
  });
  if (existing) return existing;
  return prisma.merchandisingCollection.create({
    data: { type, mode: "AUTOMATIC", isActive: true },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: { product: { select: { id: true, name: true, slug: true } } },
      },
    },
  });
}

export async function setDiscoveryMode(collectionId: string, mode: "MANUAL" | "AUTOMATIC") {
  return prisma.merchandisingCollection.update({ where: { id: collectionId }, data: { mode } });
}

/** Replaces the full ordered item list for a collection — matches the reorderable product-picker UI (whole list is submitted at once, not per-row). `max` caps how many are kept (10 for most collection types; 12 for FEATURED_BY_SUBCATEGORY per product spec). */
export async function setCollectionItems(collectionId: string, productIds: string[], max = 10) {
  await prisma.$transaction([
    prisma.merchandisingItem.deleteMany({ where: { collectionId } }),
    prisma.merchandisingItem.createMany({
      data: productIds
        .slice(0, max)
        .map((productId, position) => ({ collectionId, productId, position })),
    }),
  ]);
}

// --- Featured by Category ---------------------------------------------------

export async function listFeaturedByCategoryCollections() {
  return prisma.merchandisingCollection.findMany({
    where: { type: "FEATURED_BY_CATEGORY" },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      items: {
        orderBy: { position: "asc" },
        include: { product: { select: { id: true, name: true, slug: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Up to 5 featured categories (Complete Design/Admin Spec §7.7). */
export async function addFeaturedCategory(categoryId: string) {
  const count = await prisma.merchandisingCollection.count({
    where: { type: "FEATURED_BY_CATEGORY" },
  });
  if (count >= 5) throw new Error("At most 5 featured categories are allowed.");
  return prisma.merchandisingCollection.create({
    data: { type: "FEATURED_BY_CATEGORY", categoryId, mode: "MANUAL", isActive: true },
  });
}

export async function removeFeaturedCategory(collectionId: string) {
  await prisma.merchandisingCollection.delete({ where: { id: collectionId } });
}

// --- Featured by Subcategory --------------------------------------------------

/**
 * Unlike Featured by Category (capped at 5 — a deliberately small curated
 * set among relatively few top-level categories), every subcategory
 * appears as its own homepage row via getHomepageSubcategoryRows regardless
 * of whether it has a curated ranking here (falls back to 12 random
 * in-catalogue products), so there's no reason to cap how many
 * subcategories an admin can rank — only the DB's one-collection-per-
 * subcategory uniqueness applies (`@@unique([type, subCategoryId])`).
 */
export async function listFeaturedBySubcategoryCollections() {
  return prisma.merchandisingCollection.findMany({
    where: { type: "FEATURED_BY_SUBCATEGORY" },
    include: {
      subCategory: { select: { id: true, name: true, slug: true } },
      items: {
        orderBy: { position: "asc" },
        include: { product: { select: { id: true, name: true, slug: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function addFeaturedSubcategory(subCategoryId: string) {
  const existing = await prisma.merchandisingCollection.findFirst({
    where: { type: "FEATURED_BY_SUBCATEGORY", subCategoryId },
  });
  if (existing) throw new Error("This sub-category already has a ranking.");
  return prisma.merchandisingCollection.create({
    data: { type: "FEATURED_BY_SUBCATEGORY", subCategoryId, mode: "MANUAL", isActive: true },
  });
}

export async function removeFeaturedSubcategory(collectionId: string) {
  await prisma.merchandisingCollection.delete({ where: { id: collectionId } });
}

// --- Shop by Brand ordering --------------------------------------------------

export async function listApprovedBrandsForHomepage() {
  return prisma.brand.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ homepagePosition: "asc" }, { name: "asc" }],
  });
}

/**
 * Set (or clear, when `homepagePosition` is null) a brand's "Shop by
 * Brand" rank. Every write re-numbers the whole featured set to a clean
 * 1..N sequence — insert-at-index over the current order — so there are
 * never gaps or ties, and picking rank K on the admin dropdown lands the
 * brand exactly there (clamped into range).
 */
export async function setBrandHomepagePosition(brandId: string, homepagePosition: number | null) {
  const featured = await prisma.brand.findMany({
    where: { status: "APPROVED", homepagePosition: { not: null }, id: { not: brandId } },
    orderBy: [{ homepagePosition: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const ids = featured.map((b) => b.id);

  if (homepagePosition != null) {
    const index = Math.min(Math.max(Math.trunc(homepagePosition) - 1, 0), ids.length);
    ids.splice(index, 0, brandId);
  }

  await prisma.$transaction([
    ...(homepagePosition == null
      ? [prisma.brand.update({ where: { id: brandId }, data: { homepagePosition: null } })]
      : []),
    ...ids.map((id, i) => prisma.brand.update({ where: { id }, data: { homepagePosition: i + 1 } })),
  ]);
}

// --- Product picker (shared by discovery / featured-by-category / deal) ---

export async function searchProductsForPicker(query: string) {
  return prisma.product.findMany({
    where: {
      lifecycleStatus: "APPROVED",
      ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, name: true, slug: true, primaryImageUrl: true },
    orderBy: { name: "asc" },
    take: 25,
  });
}

// Review moderation reads/writes now live in ./reviews.ts (listReviewsForAdmin,
// moderateReview, createManualReview) — that file also owns the customer-facing
// eligibility check and submission flow, so all review logic is in one place.
