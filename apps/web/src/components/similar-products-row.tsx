"use client";

import { ScrollRow } from "@kisan4u/ui";
import { MiniProductCard } from "./homepage/mini-product-card";
import type { ProductCardData } from "@/lib/product-card-adapter";

/**
 * "Similar Products" — one horizontal row with a peek of the next card and
 * prev/next arrows (ScrollRow), sitting right under the variant picker on
 * the product page. Compact MiniProductCards, same as the homepage /
 * category grids.
 */
export function SimilarProductsRow({
  cards,
  wishlistEnabled = false,
}: {
  cards: ProductCardData[];
  wishlistEnabled?: boolean;
}) {
  if (cards.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold tracking-tight text-ink">Similar Products</h2>
      <ScrollRow ariaLabel="Similar products" itemClassName="w-[150px] sm:w-[190px]">
        {cards.map((card) => (
          <MiniProductCard key={card.id} product={card} wishlistEnabled={wishlistEnabled} />
        ))}
      </ScrollRow>
    </section>
  );
}
