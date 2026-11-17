import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSubcategoryBySlug,
  resolveCategoryName,
  resolveCategoryDescription,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { SubcategoryScroller } from "@/components/homepage/subcategory-scroller";
import { InfiniteProductGrid } from "@/components/homepage/infinite-product-grid";
import { ComingSoon } from "@/components/homepage/coming-soon";
import { loadFirstCataloguePage } from "@/lib/catalogue-first-page";
import { getDbLanguage } from "@/i18n/server";
import { ShareButton } from "@/components/share-button";
import { absoluteSiteUrl } from "@/lib/site-origin";

/**
 * Sub-category page (level 2), for customers and approved dealers alike.
 * No banner — straight into a single-row scroller of this sub-category's
 * sub-sub-category tiles, then every product in the sub-category as an
 * infinite-scroll grid (audience-aware pricing).
 */
export default async function SubCategoryPage({
  params,
}: {
  params: Promise<{ slug: string; sub: string }>;
}) {
  const { slug, sub } = await params;
  const [subcategory, dbLang] = await Promise.all([getSubcategoryBySlug(sub), getDbLanguage()]);
  if (!subcategory || subcategory.category.slug !== slug) notFound();

  const [subSubCategoriesRaw, feed] = await Promise.all([
    prisma.subSubCategory.findMany({
      where: { subCategoryId: subcategory.id, isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        translations: { select: { language: true, name: true } },
      },
    }),
    loadFirstCataloguePage({ subCategorySlug: sub }),
  ]);
  const subcategoryName = resolveCategoryName(subcategory, dbLang);
  const description = resolveCategoryDescription(subcategory, dbLang);
  const parentCategoryName = resolveCategoryName(subcategory.category, dbLang);
  const subSubCategories = subSubCategoriesRaw.map((s) => ({
    ...s,
    name: resolveCategoryName(s, dbLang),
  }));

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-3 bg-white pb-6 pt-2 md:space-y-5">
      <nav className="px-4 pt-2 text-xs text-gray-500 md:px-6 lg:px-8" aria-label="Breadcrumb">
        <Link href={`/c/${slug}`} className="hover:text-green-700">
          {parentCategoryName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-semibold text-ink">{subcategoryName}</span>
      </nav>

      <div className="px-4 md:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold tracking-tight text-ink">{subcategoryName}</h1>
          <ShareButton
            url={await absoluteSiteUrl(`/c/${encodeURIComponent(slug)}/${encodeURIComponent(sub)}`)}
            title={subcategoryName}
          />
        </div>
      </div>

      <SubcategoryScroller items={subSubCategories} hrefFor={(ssc) => `/c/${slug}/${sub}/${ssc}`} />

      <section className="px-4 md:px-6 lg:px-8">
        <h2 className="mb-1.5 text-lg font-bold tracking-tight text-ink">All {subcategoryName}</h2>
        {description && (
          <p className="mb-4 max-w-[68ch] text-sm leading-relaxed text-gray-600">{description}</p>
        )}
        {feed.cards.length === 0 ? (
          <ComingSoon />
        ) : (
          <InfiniteProductGrid
            taxonomy={{ subCategorySlug: sub }}
            initialCards={feed.cards}
            initialHasMore={feed.hasMore}
            wishlistEnabled={feed.wishlistEnabled}
          />
        )}
      </section>
    </main>
  );
}
