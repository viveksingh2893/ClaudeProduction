import { getDealerProfileForUser } from "@kisan4u/auth";
import { getActiveShopByBrand } from "@kisan4u/catalog";
import { auth } from "@/auth";
import {
  getCachedActiveHeroBanners,
  getCachedActiveCouponBanners,
  getCachedActiveSecondaryBanners,
  getCachedManualHomepageProducts,
  getCachedActiveCrops,
  getCachedActivePestsDiseases,
  getCachedHomepageCategoryRows,
  getCachedHomepageSubcategoryRows,
} from "@/lib/homepage-cache";
import { getCachedFeaturedBlogs } from "@/lib/blog-cache";
import { getT } from "@/i18n/server";
import { getCardContext } from "@/lib/card-context";
import { adaptHomepageProduct } from "@/lib/product-card-adapter";
import { BannerCarousel } from "@/components/homepage/banner-carousel";
import { CouponBannerCarousel } from "@/components/homepage/coupon-banner-carousel";
import { ProductRow } from "@/components/homepage/product-row";
import { BlogRow } from "@/components/homepage/blog-row";
import { TrustStrip } from "@/components/homepage/trust-strip";
import { FeaturedByCategory } from "@/components/homepage/featured-by-category";
import { FeaturedBySubcategory } from "@/components/homepage/featured-by-subcategory";
import { ShopByBrand } from "@/components/homepage/shop-by-brand";
import { ShopByTagStrip } from "@/components/homepage/shop-by-tag-strip";

/**
 * Section order (owner-specified):
 *   hero banner → coupon row → Shop by Brand → Best Sellers (grid) →
 *   second banner → Shop by Crop → Trending Now → Shop by Pest & Disease →
 *   the four Kisan4U benefits (TrustStrip) → one row per category
 *   (rank list, or 10 random, each with "View all →") → blog row.
 *
 * Header / category ribbon / footer / bottom-nav live in layout.tsx, never
 * here. Every section resolves its own data (banners from /admin/banners,
 * brands from /admin/homepage/brands, Best Sellers / Trending from
 * /admin/products placement).
 */
export default async function HomePage() {
  const session = await auth();
  const isDealer =
    session?.user.role === "DEALER" &&
    (await getDealerProfileForUser(session.user.id))?.status === "APPROVED";
  const dealerProfile = isDealer ? await getDealerProfileForUser(session!.user.id) : null;
  const audience: "CUSTOMER" | "DEALER" = isDealer ? "DEALER" : "CUSTOMER";
  const hrefPrefix = isDealer ? "/dealer/products" : "/products";
  const viewer = { audience, dealerStateId: dealerProfile?.stateId ?? null };
  const { t, dbLang } = await getT();

  const [
    heroBanners,
    couponBanners,
    secondaryBanners,
    brands,
    trending,
    bestSellers,
    featuredBlogs,
    crops,
    pestsDiseases,
    categoryRows,
    subcategoryRows,
  ] = await Promise.all([
    getCachedActiveHeroBanners(audience, dbLang),
    getCachedActiveCouponBanners(audience, dbLang),
    getCachedActiveSecondaryBanners(audience, dbLang),
    getActiveShopByBrand(audience),
    getCachedManualHomepageProducts("TRENDING", viewer),
    getCachedManualHomepageProducts("BEST_SELLERS", viewer),
    getCachedFeaturedBlogs(),
    getCachedActiveCrops(),
    getCachedActivePestsDiseases(),
    getCachedHomepageCategoryRows(viewer),
    getCachedHomepageSubcategoryRows(viewer),
  ]);

  const allProductIds = [
    ...trending.map((p) => p.id),
    ...bestSellers.map((p) => p.id),
    ...categoryRows.flatMap((g) => g.products.map((p) => p.id)),
    ...subcategoryRows.flatMap((g) => g.products.map((p) => p.id)),
  ];
  const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
    session?.user.id ?? null,
    allProductIds,
  );
  const wishlistEnabled = siteSettings.wishlistEnabled;

  const toCards = (list: typeof trending) =>
    list.map((p) => adaptHomepageProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }));

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-3 bg-white pb-6 md:space-y-5">
      <BannerCarousel banners={heroBanners} />
      <CouponBannerCarousel banners={couponBanners} />
      <ShopByBrand brands={brands} hrefPrefix={hrefPrefix} title={t("home.shopByBrand")} />

      <ProductRow
        title={t("home.bestSellers")}
        cards={toCards(bestSellers)}
        layout="grid"
        wishlistEnabled={wishlistEnabled}
      />

      <BannerCarousel banners={secondaryBanners} />

      <ShopByTagStrip
        title={t("home.shopByCrop")}
        ariaLabel={t("home.shopByCrop")}
        items={crops}
        hrefBase="/crops"
      />
      <ProductRow
        title={t("home.trendingNow")}
        cards={toCards(trending)}
        layout="grid"
        wishlistEnabled={wishlistEnabled}
      />
      <ShopByTagStrip
        title={t("home.shopByPestDisease")}
        ariaLabel={t("home.shopByPestDisease")}
        items={pestsDiseases}
        hrefBase="/pest-disease"
      />

      <TrustStrip />

      <FeaturedByCategory
        groups={categoryRows}
        hrefPrefix={hrefPrefix}
        categoryBasePath="/c"
        ratingThreshold={ratingThreshold}
        wishlistedIds={wishlistedIds}
        language={language}
        wishlistEnabled={wishlistEnabled}
      />

      <FeaturedBySubcategory
        groups={subcategoryRows}
        hrefPrefix={hrefPrefix}
        categoryBasePath="/c"
        ratingThreshold={ratingThreshold}
        wishlistedIds={wishlistedIds}
        language={language}
        wishlistEnabled={wishlistEnabled}
      />

      <BlogRow blogs={featuredBlogs} />
    </main>
  );
}
