import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  getCategoryBySlug,
  getCategoryHeroBanners,
  resolveCategoryName,
  resolveCategoryDescription,
} from "@kisan4u/catalog";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { prisma } from "@kisan4u/db";
import { auth } from "@/auth";
import { CategoryHero } from "@/components/homepage/category-hero";
import { SubcategoryScroller } from "@/components/homepage/subcategory-scroller";
import { InfiniteProductGrid } from "@/components/homepage/infinite-product-grid";
import { ProductGridSkeleton } from "@/components/homepage/product-grid-skeleton";
import { ComingSoon } from "@/components/homepage/coming-soon";
import { loadFirstCataloguePage } from "@/lib/catalogue-first-page";
import { getDbLanguage } from "@/i18n/server";
import { ShareButton } from "@/components/share-button";
import { absoluteSiteUrl } from "@/lib/site-origin";

/**
 * Top-level category page — reached from a ribbon tab, for BOTH customers
 * and approved dealers. The shell is the persistent root-layout instance;
 * only this body swaps on a tab change, and loading.tsx holds a steady
 * skeleton frame meanwhile. Layout: category-targeted hero carousel
 * (audience-specific banner set) → two scroll-rows of sub-category tiles →
 * infinite-scroll product feed (customer or dealer pricing per session,
 * streamed on its own so the banner + tiles paint first).
 */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const session = await auth();
  const dealerProfile =
    session?.user.role === "DEALER" ? await getDealerProfileForUser(session.user.id) : null;
  const audience =
    dealerProfile?.status === "APPROVED" ? ("DEALER" as const) : ("CUSTOMER" as const);
  const dbLang = await getDbLanguage();

  const [banners, subcategoriesRaw] = await Promise.all([
    getCategoryHeroBanners(audience, category.id, dbLang),
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
  const categoryName = resolveCategoryName(category, dbLang);
  const description = resolveCategoryDescription(category, dbLang);
  const subcategories = subcategoriesRaw.map((s) => ({
    ...s,
    name: resolveCategoryName(s, dbLang),
  }));

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-3 bg-white pb-6 md:space-y-5">
      <CategoryHero banners={banners} categoryName={categoryName} emoji={category.emoji} />

      <SubcategoryScroller items={subcategories} hrefFor={(sub) => `/c/${slug}/${sub}`} />

      <section className="px-4 md:px-6 lg:px-8">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink">All in {categoryName}</h2>
          <ShareButton
            url={await absoluteSiteUrl(`/c/${encodeURIComponent(slug)}`)}
            title={categoryName}
          />
        </div>
        {description && (
          <p className="mb-4 max-w-[68ch] text-sm leading-relaxed text-gray-600">{description}</p>
        )}
        <Suspense fallback={<ProductGridSkeleton />}>
          <CategoryProductFeed slug={slug} />
        </Suspense>
      </section>
    </main>
  );
}

async function CategoryProductFeed({ slug }: { slug: string }) {
  const { cards, hasMore, wishlistEnabled } = await loadFirstCataloguePage({ categorySlug: slug });

  if (cards.length === 0) return <ComingSoon />;

  return (
    <InfiniteProductGrid
      taxonomy={{ categorySlug: slug }}
      initialCards={cards}
      initialHasMore={hasMore}
      wishlistEnabled={wishlistEnabled}
    />
  );
}
