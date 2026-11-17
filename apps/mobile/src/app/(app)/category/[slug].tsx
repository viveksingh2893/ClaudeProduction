import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Screen } from "@/components/ui";
import { CategoryHero } from "@/components/homepage/CategoryHero";
import { SubcategoryScroller } from "@/components/homepage/SubcategoryScroller";
import { InfiniteProductGrid, type ProductPage } from "@/components/InfiniteProductGrid";
import {
  getCategoryDetail,
  getSubcategoryDetail,
  getSubSubCategoryDetail,
  getProducts,
  type CategoryDetailResponse,
  type SubcategoryDetailResponse,
  type SubSubCategoryDetailResponse,
} from "@/lib/api/catalog";
import { getDealerProducts } from "@/lib/api/dealer";
import { useAuth } from "@/context/auth-context";
import { useLanguage } from "@/context/language-context";
import { Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { siteUrl } from "@/lib/site-origin";

/**
 * All 3 taxonomy levels share this one screen — the mobile mirror of
 * apps/web/src/app/c/[slug]/page.tsx + [slug]/[sub]/page.tsx +
 * [slug]/[sub]/[subsub]/page.tsx:
 *  - level 1 (no params): hero banners → sub-category tile scroller →
 *    category description → product feed.
 *  - level 2 (`subCategory` set): sub-sub-category tile scroller →
 *    sub-category description → product feed filtered to it.
 *  - level 3 (`subSubCategory` also set): no scroller, just its own
 *    description → product feed filtered to it.
 */
export default function CategoryScreen() {
  const { slug, subCategory, subSubCategory, title } = useLocalSearchParams<{
    slug: string;
    subCategory?: string;
    subSubCategory?: string;
    title?: string;
  }>();
  const { user } = useAuth();
  const { dbLang } = useLanguage();
  const insets = useSafeAreaInsets();
  const isDealer = user?.role === "DEALER";

  const level = subSubCategory ? 3 : subCategory ? 2 : 1;

  const [categoryDetail, setCategoryDetail] = useState<CategoryDetailResponse | null>(null);
  const [subDetail, setSubDetail] = useState<SubcategoryDetailResponse | null>(null);
  const [subSubDetail, setSubSubDetail] = useState<SubSubCategoryDetailResponse | null>(null);

  useEffect(() => {
    let alive = true;
    // Non-fatal: if a detail endpoint isn't reachable we still render the
    // product feed below, just without the banner/tiles/description.
    if (level === 1) {
      getCategoryDetail(slug, dbLang).then((res) => {
        if (alive && res.ok) setCategoryDetail(res.data);
      });
    } else if (level === 2 && subCategory) {
      getSubcategoryDetail(subCategory, dbLang).then((res) => {
        if (alive && res.ok) setSubDetail(res.data);
      });
    } else if (level === 3 && subSubCategory) {
      getSubSubCategoryDetail(subSubCategory, dbLang).then((res) => {
        if (alive && res.ok) setSubSubDetail(res.data);
      });
    }
    return () => {
      alive = false;
    };
  }, [slug, subCategory, subSubCategory, level, dbLang]);

  const fetchPage = useCallback(
    async (page: number): Promise<ProductPage | null> => {
      const res = isDealer
        ? await getDealerProducts({ category: slug, subCategory, subSubCategory, page })
        : await getProducts({ category: slug, subCategory, subSubCategory, page, lang: dbLang });
      if (!res.ok) return null;
      return { items: res.data.items, hasMore: res.data.hasMore };
    },
    [isDealer, slug, subCategory, subSubCategory, dbLang],
  );

  const heading =
    level === 3
      ? (subSubDetail?.subSubCategory.name ?? title ?? "Products")
      : level === 2
        ? `All in ${subDetail?.subCategory.name ?? title ?? "this sub-category"}`
        : `All in ${categoryDetail?.category.name ?? title ?? "this category"}`;

  const description =
    level === 3
      ? subSubDetail?.subSubCategory.description
      : level === 2
        ? subDetail?.subCategory.description
        : categoryDetail?.category.description;

  const screenTitle =
    level === 3
      ? subSubDetail?.subSubCategory.name
      : level === 2
        ? subDetail?.subCategory.name
        : categoryDetail?.category.name;

  const header = (
    <View>
      {level === 1 && categoryDetail ? (
        <>
          <CategoryHero
            banners={categoryDetail.heroBanners}
            categoryName={categoryDetail.category.name}
            emoji={categoryDetail.category.emoji}
          />
          <SubcategoryScroller
            items={categoryDetail.subcategories}
            onOpen={(sub) =>
              router.push({
                pathname: "/(app)/category/[slug]",
                params: { slug, subCategory: sub.slug, title: sub.name },
              })
            }
          />
        </>
      ) : null}
      {level === 2 && subDetail ? (
        <SubcategoryScroller
          items={subDetail.subSubCategories}
          onOpen={(ssc) =>
            router.push({
              pathname: "/(app)/category/[slug]",
              params: { slug, subCategory, subSubCategory: ssc.slug, title: ssc.name },
            })
          }
        />
      ) : null}
      <AppText variant="subtitle" style={styles.heading}>
        {heading}
      </AppText>
      <View style={styles.share}>
        <ShareLinkButton
          title={screenTitle || title || "Kisan4U category"}
          url={siteUrl(
            `/c/${slug}${subCategory ? `/${subCategory}` : ""}${subSubCategory ? `/${subSubCategory}` : ""}`,
          )}
        />
      </View>
      {description ? (
        <AppText variant="caption" style={styles.description}>
          {description}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <Screen edges={["left", "right"]}>
      <Stack.Screen options={{ title: title || screenTitle || "Category" }} />
      <InfiniteProductGrid
        key={`${slug}:${subCategory ?? ""}:${subSubCategory ?? ""}`}
        fetchPage={fetchPage}
        audience={isDealer ? "DEALER" : "CUSTOMER"}
        ListHeaderComponent={header}
        emptyTitle="No products in this category yet"
        contentBottomInset={TAB_BAR_SCENE_INSET + insets.bottom}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xs },
  description: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    lineHeight: 18,
    opacity: 0.7,
  },
  share: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, alignItems: "flex-start" },
});
