"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MiniProductCard } from "./mini-product-card";
import { ProductGridSkeleton } from "./product-grid-skeleton";
import type { ProductCardData } from "@/lib/product-card-adapter";
import type { CatalogueTaxonomy } from "@/lib/catalogue-page";
import { loadCatalogueProductsPage } from "@/lib/catalogue-page-action";

/**
 * The "All products" grid on a category / sub-category / sub-sub-category
 * page — 2 columns on mobile, ramping to 4 on desktop, with infinite
 * scroll (20 per page). The first page is server-rendered; subsequent
 * pages are pulled by a server action as a sentinel near the bottom comes
 * into view. Rendered by MiniProductCard (image + title + price, tap to
 * the product page).
 */
export function InfiniteProductGrid({
  taxonomy,
  initialCards,
  initialHasMore,
  wishlistEnabled = false,
  excludeIds,
}: {
  taxonomy: CatalogueTaxonomy;
  initialCards: ProductCardData[];
  initialHasMore: boolean;
  wishlistEnabled?: boolean;
  /** Product ids to drop from every page — e.g. the current product on its own detail page. */
  excludeIds?: string[];
}) {
  const excluded = useRef(new Set(excludeIds ?? []));
  const [cards, setCards] = useState(() =>
    initialCards.filter((c) => !excluded.current.has(c.id)),
  );
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadNext = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setFailed(false);
    try {
      const next = page + 1;
      const res = await loadCatalogueProductsPage(taxonomy, next);
      setCards((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [
          ...prev,
          ...res.cards.filter((c) => !seen.has(c.id) && !excluded.current.has(c.id)),
        ];
      });
      setPage(next);
      setHasMore(res.hasMore);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, taxonomy]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadNext();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadNext]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((card) => (
          <MiniProductCard key={card.id} product={card} wishlistEnabled={wishlistEnabled} />
        ))}
      </div>

      {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-1 w-full" />}

      {loading && (
        <div className="mt-5">
          <ProductGridSkeleton count={5} />
        </div>
      )}
      {failed && (
        <div className="py-6 text-center">
          <button
            type="button"
            onClick={() => void loadNext()}
            className="rounded-md border border-border px-4 py-2 text-sm font-bold text-green-700 hover:bg-green-50"
          >
            Couldn&rsquo;t load more — retry
          </button>
        </div>
      )}
      {!hasMore && !loading && cards.length > CATALOGUE_HINT && (
        <p className="py-8 text-center text-xs text-gray-400">You&rsquo;ve seen everything.</p>
      )}
    </div>
  );
}

const CATALOGUE_HINT = 12;
