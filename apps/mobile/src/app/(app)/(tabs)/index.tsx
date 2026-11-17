import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ErrorState, Screen } from "@/components/ui";
import { ProductRow } from "@/components/ProductRow";
import { BannerCarousel } from "@/components/homepage/BannerCarousel";
import { CouponBannerCarousel } from "@/components/homepage/CouponBannerCarousel";
import { BrandRow } from "@/components/homepage/BrandRow";
import { ShopByTagStrip } from "@/components/homepage/ShopByTagStrip";
import { TrustStrip } from "@/components/homepage/TrustStrip";
import { getHomepage } from "@/lib/api/catalog";
import { useLanguage } from "@/context/language-context";
import { Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import type {
  CustomerProductDTO,
  HeroBannerDTO,
  HomepageBrandDTO,
  HomepageCategoryRowDTO,
  HomepageSubcategoryRowDTO,
  HomepageCropPestDTO,
} from "@/lib/api/types";

/**
 * Storefront homepage — the mobile mirror of apps/web/src/app/page.tsx.
 * The green ribbon, white header and sticky category ribbon are supplied by
 * <AppChrome>; this screen is just the scrolling content, in the exact
 * owner-specified section order:
 *
 *   hero banners → coupon strip → Shop by Brand → Best Sellers (2-col) →
 *   second banner → Shop by Crop → Trending Now (2-col) →
 *   Shop by Pest & Disease → the four Kisan4U benefits → one 2-col rail per
 *   category (each "View all ›" opens that category's page).
 *
 * All product grids are 2-per-row (layout="grid").
 */
export default function HomeScreen() {
  const { dbLang, t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [banners, setBanners] = useState<HeroBannerDTO[]>([]);
  const [couponBanners, setCouponBanners] = useState<HeroBannerDTO[]>([]);
  const [secondaryBanners, setSecondaryBanners] = useState<HeroBannerDTO[]>([]);
  const [brands, setBrands] = useState<HomepageBrandDTO[]>([]);
  const [trending, setTrending] = useState<CustomerProductDTO[]>([]);
  const [bestSellers, setBestSellers] = useState<CustomerProductDTO[]>([]);
  const [crops, setCrops] = useState<HomepageCropPestDTO[]>([]);
  const [pestsDiseases, setPestsDiseases] = useState<HomepageCropPestDTO[]>([]);
  const [categoryRows, setCategoryRows] = useState<HomepageCategoryRowDTO[]>([]);
  const [subcategoryRows, setSubcategoryRows] = useState<HomepageSubcategoryRowDTO[]>([]);
  const [audience, setAudience] = useState<"CUSTOMER" | "DEALER">("CUSTOMER");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await getHomepage(dbLang);
    if (!result.ok) {
      setError(result.error.message);
    } else {
      setError(null);
      setAudience(result.data.audience);
      setBanners(result.data.heroBanners ?? []);
      setCouponBanners(result.data.couponBanners ?? []);
      setSecondaryBanners(result.data.secondaryBanners ?? []);
      setBrands(result.data.brands ?? []);
      setTrending(result.data.trending ?? []);
      setBestSellers(result.data.bestSellers ?? []);
      setCrops(result.data.crops ?? []);
      setPestsDiseases(result.data.pestsDiseases ?? []);
      setCategoryRows(result.data.categoryRows ?? []);
      setSubcategoryRows(result.data.subcategoryRows ?? []);
    }
    setLoading(false);
  }, [dbLang]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const sections = useMemo<{ key: string; node: ReactElement }[]>(() => [
    { key: "hero", node: <View style={styles.bannerWrap}><BannerCarousel banners={banners} loading={loading} /></View> },
    { key: "coupons", node: <View style={styles.couponBannerWrap}><CouponBannerCarousel banners={couponBanners} loading={loading} /></View> },
    ...(!loading && brands.length ? [{ key: "brands", node: <BrandRow brands={brands} /> }] : []),
    { key: "best", node: <ProductRow title={t("home.bestSellers")} products={bestSellers} audience={audience} layout="grid" /> },
    ...(secondaryBanners.length ? [{ key: "secondary", node: <View style={styles.secondaryBannerWrap}><BannerCarousel banners={secondaryBanners} /></View> }] : []),
    { key: "crops", node: <ShopByTagStrip title={t("home.shopByCrop")} items={crops} kind="crop" /> },
    { key: "trending", node: <ProductRow title={t("home.trendingNow")} products={trending} audience={audience} layout="grid" /> },
    { key: "pests", node: <ShopByTagStrip title={t("home.shopByPestDisease")} items={pestsDiseases} kind="pest" /> },
    ...(!loading ? [{ key: "trust", node: <TrustStrip /> }] : []),
    ...categoryRows.map((row) => ({ key: `category-${row.category.id}`, node: <ProductRow title={row.category.name} products={row.products} audience={audience} layout="grid" viewMoreHref={{ pathname: "/(app)/category/[slug]", params: { slug: row.category.slug } }} /> })),
    ...subcategoryRows.map((row) => ({ key: `subcategory-${row.subCategory.id}`, node: <ProductRow title={row.subCategory.name} products={row.products} audience={audience} layout="grid" viewMoreHref={{ pathname: "/(app)/category/[slug]", params: { slug: row.subCategory.categorySlug, subCategory: row.subCategory.slug, title: row.subCategory.name } }} /> })),
    { key: "bottom", node: <View style={{ height: insets.bottom + TAB_BAR_SCENE_INSET }} /> },
  ], [audience, banners, bestSellers, brands, categoryRows, couponBanners, crops, insets.bottom, loading, pestsDiseases, secondaryBanners, subcategoryRows, t, trending]);

  if (error) {
    return (
      <Screen edges={["left", "right"]}>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen edges={["left", "right"]}>
      <FlatList
        data={sections}
        keyExtractor={(section) => section.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={80}
        windowSize={3}
        removeClippedSubviews
        renderItem={({ item }) => item.node}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bannerWrap: { paddingTop: Spacing.md },
  couponBannerWrap: { paddingTop: Spacing.lg },
  secondaryBannerWrap: { paddingTop: Spacing.lg },
});
