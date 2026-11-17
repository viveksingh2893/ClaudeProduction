import Link from "next/link";
import { PageContainer, SectionHeader, ScrollRow } from "@kisan4u/ui";
import type { getActiveTopLevelCategoriesForHomepage } from "@kisan4u/catalog";

type Category = Awaited<ReturnType<typeof getActiveTopLevelCategoriesForHomepage>>[number];

/**
 * Replaces the previous CategoryHomepageAsset-driven "Shop by Category"
 * section (apps/web/src/components/homepage/top-categories.tsx, now
 * deleted) — that one was an admin-curated subset with its own distinct
 * per-category image; this shows every active top-level category
 * automatically, using the category's own existing image, ordered by
 * Category.position (see /admin/categories). Two sections with the same
 * name and the same purpose would just be visually duplicated content.
 *
 * A single ScrollRow (no wrapping to a second row, per spec) — normal
 * flex layout with no controls if everything fits, horizontally
 * scrollable with prev/next once it doesn't.
 */
export function ShopByCategory({
  categories,
  hrefPrefix,
}: {
  categories: Category[];
  hrefPrefix: string;
}) {
  if (categories.length === 0) return null;

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <SectionHeader title="Shop by Category" />
      <ScrollRow ariaLabel="Shop by category" itemClassName="w-[42%] sm:w-[180px] lg:w-[200px]">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`${hrefPrefix}?category=${c.slug}`}
            className="group flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-surface p-3 text-center transition-colors hover:border-green-500 hover:shadow-card"
          >
            <div className="aspect-square w-full overflow-hidden rounded-lg bg-green-50">
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- no image optimizer/storage provider configured yet
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-medium text-gray-400">
                  {c.name}
                </div>
              )}
            </div>
            <span className="text-xs font-semibold leading-tight text-ink">{c.name}</span>
          </Link>
        ))}
      </ScrollRow>
    </PageContainer>
  );
}
