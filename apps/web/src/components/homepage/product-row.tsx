import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ScrollRow } from "@kisan4u/ui";
import { MiniProductCard } from "./mini-product-card";
import type { ProductCardData } from "@/lib/product-card-adapter";

/**
 * A homepage / category-page product section. `layout="scroll"` (default)
 * is a single horizontally-scrolling row of compact MiniProductCards;
 * `layout="grid"` wraps them into a 2 (mobile) / 3 (tablet) / 4 (laptop)
 * column grid — used for Best Sellers. A 17px bold header with an optional
 * "View all →" affordance. `tinted` wraps the section in a pale green
 * card. Renders nothing when empty.
 */
export function ProductRow({
  title,
  cards,
  viewMoreHref,
  tinted = false,
  layout = "scroll",
  wishlistEnabled = false,
}: {
  title: string;
  cards: ProductCardData[];
  viewMoreHref?: string;
  tinted?: boolean;
  layout?: "scroll" | "grid";
  wishlistEnabled?: boolean;
  /** Accepted for source compatibility with older call sites. */
  siteSettings?: unknown;
}) {
  if (cards.length === 0) return null;

  const header = (
    <div
      className={`mb-3 flex items-center justify-between gap-3 ${tinted ? "px-4" : "px-4 md:px-6 lg:px-8"}`}
    >
      <h2 className="text-[17px] font-bold tracking-tight text-ink md:text-lg">{title}</h2>
      {viewMoreHref && (
        <Link
          href={viewMoreHref}
          aria-label={`View all ${title}`}
          className="flex h-7 items-center gap-0.5 rounded-full px-1.5 text-xs font-bold text-green-700 hover:bg-green-50"
        >
          <span className="hidden sm:inline">View all</span>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );

  const body =
    layout === "grid" ? (
      <div
        className={`grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4 ${
          tinted ? "px-4" : "px-4 md:px-6 lg:px-8"
        }`}
      >
        {cards.map((card) => (
          <MiniProductCard key={card.id} product={card} wishlistEnabled={wishlistEnabled} />
        ))}
      </div>
    ) : (
      <ScrollRow
        ariaLabel={title}
        className={`gap-3 pr-12 ${tinted ? "pl-4" : "pl-4 md:pl-6 lg:pl-8"}`}
        itemClassName="w-[38vw] max-w-[150px] sm:w-[26vw] md:w-[20vw] lg:w-[15vw]"
      >
        {cards.map((card) => (
          <MiniProductCard key={card.id} product={card} wishlistEnabled={wishlistEnabled} />
        ))}
      </ScrollRow>
    );

  if (tinted) {
    return (
      <section className="px-4 md:px-6 lg:px-8">
        <div className="overflow-hidden rounded-2xl bg-green-50/70 py-3">
          {header}
          {body}
        </div>
      </section>
    );
  }

  return (
    <section className="py-1">
      {header}
      {body}
    </section>
  );
}
