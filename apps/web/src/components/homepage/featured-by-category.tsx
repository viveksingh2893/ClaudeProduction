import { adaptHomepageProduct, type HomepageProduct } from "@/lib/product-card-adapter";
import type { DbLanguage } from "@kisan4u/validators";
import { ProductRow } from "./product-row";

type Group = {
  category: { id: string; name: string; slug: string };
  products: HomepageProduct[];
};

/**
 * The per-category homepage rows — one product rail per category, each with
 * a "View all →" that opens that category's page (customer) or its filtered
 * catalogue (dealer). Fed the "all categories" list from
 * getHomepageCategoryRows (ranked products, or 10 random).
 */
export function FeaturedByCategory({
  groups,
  hrefPrefix,
  categoryBasePath,
  ratingThreshold,
  wishlistedIds,
  language,
  wishlistEnabled = false,
}: {
  groups: Group[];
  hrefPrefix: string;
  /** customer = "/c" → the category page; omitted (dealer) → filtered list. */
  categoryBasePath?: string;
  siteSettings?: unknown;
  ratingThreshold: number;
  wishlistedIds: Set<string>;
  language?: DbLanguage;
  wishlistEnabled?: boolean;
}) {
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((group) => (
        <ProductRow
          key={group.category.id}
          title={group.category.name}
          layout="grid"
          wishlistEnabled={wishlistEnabled}
          viewMoreHref={
            categoryBasePath
              ? `${categoryBasePath}/${group.category.slug}`
              : `${hrefPrefix}?category=${group.category.slug}`
          }
          cards={group.products.map((p) =>
            adaptHomepageProduct(p, {
              ratingThreshold,
              wishlisted: wishlistedIds.has(p.id),
              language,
            }),
          )}
        />
      ))}
    </>
  );
}
