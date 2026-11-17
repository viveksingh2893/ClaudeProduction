import { NextRequest } from "next/server";
import {
  getSubSubCategoryBySlug,
  resolveCategoryName,
  resolveCategoryDescription,
} from "@kisan4u/catalog";
import { toDbLanguage } from "@kisan4u/validators";
import { jsonError, jsonOk, withMobileApi } from "@/lib/mobile-api";

/**
 * One sub-sub-category's page data — the mobile mirror of
 * apps/web/src/app/c/[slug]/[sub]/[subsub]/page.tsx: leaf node, no tile
 * rows of its own. The infinite product feed is fetched separately through
 * /api/mobile/v1/catalog/products?subSubCategory=<slug>&page=N. Public, no
 * auth required.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withMobileApi(async () => {
    const { slug } = await params;
    const node = await getSubSubCategoryBySlug(slug);
    if (!node)
      return jsonError(404, "SUBSUBCATEGORY_NOT_FOUND", "That sub-sub-category doesn't exist.");

    const language = toDbLanguage(req.nextUrl.searchParams.get("lang"));

    return jsonOk({
      subSubCategory: {
        id: node.id,
        name: resolveCategoryName(node, language),
        slug: node.slug,
        imageUrl: node.imageUrl,
        description: resolveCategoryDescription(node, language),
      },
      subCategory: {
        id: node.subCategory.id,
        name: resolveCategoryName(node.subCategory, language),
        slug: node.subCategory.slug,
      },
      category: {
        id: node.subCategory.category.id,
        name: resolveCategoryName(node.subCategory.category, language),
        slug: node.subCategory.category.slug,
      },
    });
  });
}
