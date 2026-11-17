import { NextRequest } from "next/server";
import {
  getActiveShopByBrand,
  getActiveTopLevelCategoriesForHomepage,
  resolveCategoryName,
  resolveProductName,
} from "@kisan4u/catalog";
import {
  getCachedHomepageModel,
  getCachedActiveHeroBanners,
  getCachedActiveCouponBanners,
  getCachedActiveSecondaryBanners,
  getCachedActiveCrops,
  getCachedActivePestsDiseases,
  getCachedHomepageCategoryRows,
  getCachedHomepageSubcategoryRows,
  getCachedManualHomepageProducts,
} from "@/lib/homepage-cache";
import { toDbLanguage } from "@kisan4u/validators";
import { jsonOk, resolveCatalogViewer, withMobileApi } from "@/lib/mobile-api";

/**
 * Same admin-controlled homepage model the website renders (sections,
 * hero banners, coupon banners, trending/best-sellers/new-arrivals) —
 * audience-switched on the caller's role exactly like apps/web's homepage
 * page. Guest (unauthenticated) browsing renders the CUSTOMER audience,
 * matching "browse before login" on the website. `categories` and `brands`
 * are the same fixed-position, independent-of-HomepageSection sources
 * apps/web's homepage reads directly (getActiveTopLevelCategoriesForHomepage,
 * getActiveShopByBrand) — added here so the mobile app's category row and
 * Shop by Brand rail don't need a separate request.
 *
 * `secondaryBanners`, `crops`, `pestsDiseases` and `categoryRows` were
 * added so the mobile home screen can render the SAME full section list as
 * apps/web/src/app/page.tsx (Shop by Crop / second banner / Shop by Pest &
 * Disease / one rail per category), from one request.
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const viewer = await resolveCatalogViewer(req);
    const { audience } = viewer;
    // Optional ?lang= (en|hi|mr|te|ta) so the mobile app can request a
    // localized banner set; defaults to EN when absent/unknown.
    const language = toDbLanguage(req.nextUrl.searchParams.get("lang"));
    // The mobile ProductCard renders `product.name` straight from the
    // payload (no client-side translation layer), so the display name has
    // to be resolved here — same as apps/web's card adapters do via
    // resolveProductName. Only the name; the rest of the row is untouched.
    const localize = <T extends { name: string; translations?: unknown }>(rows: T[]): T[] =>
      language === "EN"
        ? rows
        : rows.map((p) => ({
            ...p,
            name: resolveProductName(
              p as { name: string; translations?: { language: string; name?: string | null }[] },
              language,
            ),
          }));
    const [
      model,
      heroBanners,
      couponBanners,
      secondaryBanners,
      categories,
      brands,
      trending,
      bestSellers,
      newArrivals,
      crops,
      pestsDiseases,
      categoryRows,
      subcategoryRows,
    ] = await Promise.all([
      getCachedHomepageModel(viewer),
      getCachedActiveHeroBanners(audience, language),
      getCachedActiveCouponBanners(audience, language),
      getCachedActiveSecondaryBanners(audience, language),
      getActiveTopLevelCategoriesForHomepage(),
      getActiveShopByBrand(audience),
      getCachedManualHomepageProducts("TRENDING", viewer),
      getCachedManualHomepageProducts("BEST_SELLERS", viewer),
      getCachedManualHomepageProducts("NEW_ARRIVALS", viewer),
      getCachedActiveCrops(),
      getCachedActivePestsDiseases(),
      getCachedHomepageCategoryRows(viewer),
      getCachedHomepageSubcategoryRows(viewer),
    ]);

    return jsonOk({
      audience,
      model,
      heroBanners,
      couponBanners,
      secondaryBanners,
      categories: categories.map((c) => ({ ...c, name: resolveCategoryName(c, language) })),
      brands,
      trending: localize(trending),
      bestSellers: localize(bestSellers),
      newArrivals: localize(newArrivals),
      crops,
      pestsDiseases,
      categoryRows: categoryRows.map((g) => ({ ...g, products: localize(g.products) })),
      subcategoryRows: subcategoryRows.map((g) => ({ ...g, products: localize(g.products) })),
    });
  });
}
