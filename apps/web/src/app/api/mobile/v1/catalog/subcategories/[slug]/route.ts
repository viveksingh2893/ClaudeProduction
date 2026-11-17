import { NextRequest } from "next/server";
import {
  getSubcategoryBySlug,
  resolveCategoryName,
  resolveCategoryDescription,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { toDbLanguage } from "@kisan4u/validators";
import { jsonError, jsonOk, withMobileApi } from "@/lib/mobile-api";

/**
 * One sub-category's page data — the mobile mirror of
 * apps/web/src/app/c/[slug]/[sub]/page.tsx: the sub-category's own name/
 * description plus its parent category and active sub-sub-categories. The
 * infinite product feed is fetched separately through
 * /api/mobile/v1/catalog/products?subCategory=<slug>&page=N. Public, no
 * auth required.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withMobileApi(async () => {
    const { slug } = await params;
    const subcategory = await getSubcategoryBySlug(slug);
    if (!subcategory)
      return jsonError(404, "SUBCATEGORY_NOT_FOUND", "That sub-category doesn't exist.");

    const language = toDbLanguage(req.nextUrl.searchParams.get("lang"));

    const subSubCategoriesRaw = await prisma.subSubCategory.findMany({
      where: { subCategoryId: subcategory.id, isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        translations: { select: { language: true, name: true } },
      },
    });
    const subSubCategories = subSubCategoriesRaw.map((s) => ({
      id: s.id,
      name: resolveCategoryName(s, language),
      slug: s.slug,
      imageUrl: s.imageUrl,
    }));

    return jsonOk({
      subCategory: {
        id: subcategory.id,
        name: resolveCategoryName(subcategory, language),
        slug: subcategory.slug,
        imageUrl: subcategory.imageUrl,
        description: resolveCategoryDescription(subcategory, language),
      },
      category: {
        id: subcategory.category.id,
        name: resolveCategoryName(subcategory.category, language),
        slug: subcategory.category.slug,
      },
      subSubCategories,
    });
  });
}
