import { unstable_cache } from "next/cache";
import {
  getHomepageModel,
  getActiveHeroBanners,
  getActiveCouponBanners,
  getActiveSecondaryBanners,
  getHomepageCategoryRows,
  getHomepageSubcategoryRows,
  getManualHomepageProducts,
  getActiveCrops,
  getActivePestsDiseases,
  type HomepageViewer,
  type HomepageViewerAudience,
} from "@kisan4u/catalog";
import type { MerchandisingType } from "@kisan4u/db";
import { type DbLanguage, DEFAULT_DB_LANGUAGE } from "@kisan4u/validators";

/**
 * Complete Design/Admin Spec §12.3/§13.4: cache the homepage model, keyed
 * by viewer audience only (CUSTOMER vs DEALER — no dealer-state key needed
 * since nothing in this scope's homepage content is state-specific).
 * revalidateTag("homepage") is called from every admin composer mutation
 * (apps/dashboard/src/app/admin/homepage/actions.ts), so a published
 * change is visible without waiting out the 60s window below. Per-user
 * wishlist state is fetched separately and never cached here (see
 * apps/web/src/lib/card-context.ts) — mixing user-specific data into this
 * cached function would either leak between users or defeat the cache.
 */
const getCachedHomepageModelByAudience = unstable_cache(
  async (audience: HomepageViewer["audience"], dealerStateId: string | null) =>
    getHomepageModel({ audience, dealerStateId }),
  ["homepage-model"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedHomepageModel(viewer: HomepageViewer) {
  return getCachedHomepageModelByAudience(viewer.audience, viewer.dealerStateId ?? null);
}

/**
 * Same cache/revalidation contract as getCachedHomepageModel above (same
 * "homepage" tag — the admin Banners tab's save/delete actions revalidate
 * that one tag, so this and the homepage model go stale/fresh together),
 * kept as its own cache entry since banners no longer route through
 * HomepageSection/getHomepageModel at all (see getActiveHeroBanners' doc
 * comment in packages/catalog/src/homepage.ts).
 */
const getCachedActiveHeroBannersByAudience = unstable_cache(
  async (audience: HomepageViewerAudience, language: DbLanguage) =>
    getActiveHeroBanners(audience, language),
  ["active-hero-banners"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedActiveHeroBanners(
  audience: HomepageViewerAudience,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  return getCachedActiveHeroBannersByAudience(audience, language);
}

/**
 * Same cache/revalidation contract as getCachedActiveHeroBanners above (same
 * "homepage" tag, same admin Banners page revalidation path — see
 * getActiveCouponBanners' doc comment in packages/catalog/src/homepage.ts),
 * kept as its own cache entry/key so the hero and coupon carousels can be
 * fetched and revalidated independently.
 */
const getCachedActiveCouponBannersByAudience = unstable_cache(
  async (audience: HomepageViewerAudience, language: DbLanguage) =>
    getActiveCouponBanners(audience, language),
  ["active-coupon-banners"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedActiveCouponBanners(
  audience: HomepageViewerAudience,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  return getCachedActiveCouponBannersByAudience(audience, language);
}

/** The homepage's second banner carousel — same contract as the hero/coupon caches. */
const getCachedActiveSecondaryBannersByAudience = unstable_cache(
  async (audience: HomepageViewerAudience, language: DbLanguage) =>
    getActiveSecondaryBanners(audience, language),
  ["active-secondary-banners"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedActiveSecondaryBanners(
  audience: HomepageViewerAudience,
  language: DbLanguage = DEFAULT_DB_LANGUAGE,
) {
  return getCachedActiveSecondaryBannersByAudience(audience, language);
}

/**
 * The "all categories" homepage block — one product row per active
 * top-level category (rank list, or 10 random). Same "homepage" tag / 60s
 * contract; keyed by audience + dealer state.
 */
const getCachedHomepageCategoryRowsByParams = unstable_cache(
  async (audience: HomepageViewerAudience, dealerStateId: string | null) =>
    getHomepageCategoryRows({ audience, dealerStateId }),
  ["homepage-category-rows"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedHomepageCategoryRows(viewer: HomepageViewer) {
  return getCachedHomepageCategoryRowsByParams(viewer.audience, viewer.dealerStateId ?? null);
}

/**
 * The "all subcategories" homepage block — one product row per active
 * subcategory (rank list of up to 12, or 12 random), shown after every
 * category row. Same "homepage" tag / 60s contract as above.
 */
const getCachedHomepageSubcategoryRowsByParams = unstable_cache(
  async (audience: HomepageViewerAudience, dealerStateId: string | null) =>
    getHomepageSubcategoryRows({ audience, dealerStateId }),
  ["homepage-subcategory-rows"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedHomepageSubcategoryRows(viewer: HomepageViewer) {
  return getCachedHomepageSubcategoryRowsByParams(viewer.audience, viewer.dealerStateId ?? null);
}

/**
 * Trending / Best Sellers / New Arrivals — same "homepage" tag/60s TTL
 * contract as above, so the admin/products placement editor's revalidation
 * call (which pings this same tag) keeps all of these in sync together.
 * Parameterized by `type` so the three sections are three independent
 * cache entries, matching their independent admin-side ordering.
 */
const getCachedManualHomepageProductsByParams = unstable_cache(
  async (type: MerchandisingType, audience: HomepageViewerAudience, dealerStateId: string | null) =>
    getManualHomepageProducts(type, { audience, dealerStateId }),
  ["manual-homepage-products"],
  { tags: ["homepage"], revalidate: 60 },
);

export async function getCachedManualHomepageProducts(
  type: MerchandisingType,
  viewer: HomepageViewer,
) {
  return getCachedManualHomepageProductsByParams(
    type,
    viewer.audience,
    viewer.dealerStateId ?? null,
  );
}

/**
 * "Shop by Crop" / "Shop by Pest & Disease" homepage strips (Homepage
 * redesign, phase B). Audience-independent — the same list of active
 * crops/pests shows to customers and dealers; only the link target
 * differs, and that's resolved at render time, not here. Same "homepage"
 * tag / 60s TTL contract as the rest of this file, so an admin add/edit/
 * toggle under /admin/crops or /admin/pests (which revalidates that tag)
 * shows up without waiting out the window.
 */
export const getCachedActiveCrops = unstable_cache(
  async () => getActiveCrops(),
  ["active-crops"],
  { tags: ["homepage"], revalidate: 60 },
);

export const getCachedActivePestsDiseases = unstable_cache(
  async () => getActivePestsDiseases(),
  ["active-pests-diseases"],
  { tags: ["homepage"], revalidate: 60 },
);
