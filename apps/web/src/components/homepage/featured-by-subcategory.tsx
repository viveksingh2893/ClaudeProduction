import { adaptHomepageProduct, type HomepageProduct } from "@/lib/product-card-adapter";
import type { DbLanguage } from "@kisan4u/validators";
import { ProductRow } from "./product-row";

type Group = {
  subCategory: { id: string; name: string; slug: string; categorySlug: string };
  products: HomepageProduct[];
};

/**
 * The per-subcategory homepage rows — one product rail per subcategory,
 * shown after every category row (see FeaturedByCategory, which this
 * mirrors one level down). Fed the "all subcategories" list from
 * getHomepageSubcategoryRows (ranked products, or 12 random).
 */
export function FeaturedBySubcategory({
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
  /** customer = "/c" → the subcategory page; omitted (dealer) → filtered list. */
  categoryBasePath?: string;
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
          key={group.subCategory.id}
          title={group.subCategory.name}
          layout="grid"
          wishlistEnabled={wishlistEnabled}
          viewMoreHref={
            categoryBasePath
              ? `${categoryBasePath}/${group.subCategory.categorySlug}/${group.subCategory.slug}`
              : `${hrefPrefix}?subCategory=${group.subCategory.slug}`
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
