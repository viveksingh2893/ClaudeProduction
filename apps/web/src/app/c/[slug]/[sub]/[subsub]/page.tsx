import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSubSubCategoryBySlug,
  resolveCategoryName,
  resolveCategoryDescription,
} from "@kisan4u/catalog";
import { InfiniteProductGrid } from "@/components/homepage/infinite-product-grid";
import { ComingSoon } from "@/components/homepage/coming-soon";
import { loadFirstCataloguePage } from "@/lib/catalogue-first-page";
import { getDbLanguage } from "@/i18n/server";
import { ShareButton } from "@/components/share-button";
import { absoluteSiteUrl } from "@/lib/site-origin";

/**
 * Sub-sub-category page (level 3) — the leaf, for customers and approved
 * dealers alike. Breadcrumb + heading, then the product grid (infinite
 * scroll, audience-aware pricing). No tile rows, no banner.
 */
export default async function SubSubCategoryPage({
  params,
}: {
  params: Promise<{ slug: string; sub: string; subsub: string }>;
}) {
  const { slug, sub, subsub } = await params;
  const [node, dbLang] = await Promise.all([getSubSubCategoryBySlug(subsub), getDbLanguage()]);
  if (!node || node.subCategory.slug !== sub || node.subCategory.category.slug !== slug) {
    notFound();
  }

  const feed = await loadFirstCataloguePage({ subSubCategorySlug: subsub });
  const nodeName = resolveCategoryName(node, dbLang);
  const description = resolveCategoryDescription(node, dbLang);
  const subName = resolveCategoryName(node.subCategory, dbLang);
  const catName = resolveCategoryName(node.subCategory.category, dbLang);

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-3 bg-white pb-6 pt-2 md:space-y-5">
      <nav className="px-4 pt-2 text-xs text-gray-500 md:px-6 lg:px-8" aria-label="Breadcrumb">
        <Link href={`/c/${slug}`} className="hover:text-green-700">
          {catName}
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/c/${slug}/${sub}`} className="hover:text-green-700">
          {subName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-semibold text-ink">{nodeName}</span>
      </nav>

      <section className="px-4 md:px-6 lg:px-8">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold tracking-tight text-ink">{nodeName}</h1>
          <ShareButton
            url={await absoluteSiteUrl(
              `/c/${encodeURIComponent(slug)}/${encodeURIComponent(sub)}/${encodeURIComponent(subsub)}`,
            )}
            title={nodeName}
          />
        </div>
        {description && (
          <p className="mb-4 max-w-[68ch] text-sm leading-relaxed text-gray-600">{description}</p>
        )}
        {feed.cards.length === 0 ? (
          <ComingSoon />
        ) : (
          <InfiniteProductGrid
            taxonomy={{ subSubCategorySlug: subsub }}
            initialCards={feed.cards}
            initialHasMore={feed.hasMore}
            wishlistEnabled={feed.wishlistEnabled}
          />
        )}
      </section>
    </main>
  );
}
