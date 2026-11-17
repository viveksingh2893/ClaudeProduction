import { NextRequest } from "next/server";
import {
  getCategoryBySlug,
  getCategoryHeroBanners,
  resolveCategoryName,
  resolveCategoryDescription,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { toDbLanguage } from "@kisan4u/validators";
import { jsonError, jsonOk, resolveCatalogViewer, withMobileApi } from "@/lib/mobile-api";

/**
 * One top-level category's page data — the mobile mirror of
 * apps/web/src/app/c/[slug]/page.tsx: the category's own hero banner
 * carousel (audience-specific, via getCategoryHeroBanners) plus its active
 * sub-categories. The infinite product feed is fetched separately through
 * /api/mobile/v1/catalog/products?category=<slug>&page=N. Public, no auth
 * required (an approved dealer gets the DEALER banner set).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withMobileApi(async () => {
    const { slug } = await params;
    const category = await getCategoryBySlug(slug);
    if (!category) return jsonError(404, "CATEGORY_NOT_FOUND", "That category doesn't exist.");

    const { audience } = await resolveCatalogViewer(req);
    const language = toDbLanguage(req.nextUrl.searchParams.get("lang"));

    const [heroBanners, subcategoriesRaw] = await Promise.all([
      getCategoryHeroBanners(audience, category.id, language),
      prisma.subcategory.findMany({
        where: { categoryId: category.id, isActive: true },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          translations: { select: { language: true, name: true } },
        },
      }),
    ]);
    const subcategories = subcategoriesRaw.map((s) => ({
      id: s.id,
      name: resolveCategoryName(s, language),
      slug: s.slug,
      imageUrl: s.imageUrl,
    }));

    return jsonOk({
      category: {
        id: category.id,
        name: resolveCategoryName(category, language),
        slug: category.slug,
        emoji: category.emoji,
        imageUrl: category.imageUrl,
        description: resolveCategoryDescription(category, language),
      },
      heroBanners,
      subcategories,
    });
  });
}
