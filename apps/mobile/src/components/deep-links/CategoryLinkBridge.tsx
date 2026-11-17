import { router } from "expo-router";
import { OpeningLink } from "@/components/OpeningLink";
import { useDeepLinkBridge } from "@/hooks/use-deep-link-bridge";
import {
  getCategoryDetail,
  getSubcategoryDetail,
  getSubSubCategoryDetail,
} from "@/lib/api/catalog";

export function CategoryLinkBridge({
  slug,
  sub,
  subsub,
}: {
  slug?: string;
  sub?: string;
  subsub?: string;
}) {
  useDeepLinkBridge(async ({ ensureGuest }) => {
    if (!(await ensureGuest())) return;
    const categorySlug = slug?.trim();
    if (!categorySlug || !(await getCategoryDetail(categorySlug)).ok) {
      router.replace("/(app)/(tabs)");
      return;
    }

    let validSub: string | undefined;
    let validSubSub: string | undefined;
    if (sub) {
      const detail = await getSubcategoryDetail(sub);
      if (detail.ok && detail.data.category.slug === categorySlug) validSub = sub;
    }
    if (validSub && subsub) {
      const detail = await getSubSubCategoryDetail(subsub);
      if (
        detail.ok &&
        detail.data.category.slug === categorySlug &&
        detail.data.subCategory.slug === validSub
      ) {
        validSubSub = subsub;
      }
    }

    router.replace({
      pathname: "/(app)/category/[slug]",
      params: {
        slug: categorySlug,
        subCategory: validSub,
        subSubCategory: validSubSub,
      },
    });
  });
  return <OpeningLink label="Opening category…" />;
}
