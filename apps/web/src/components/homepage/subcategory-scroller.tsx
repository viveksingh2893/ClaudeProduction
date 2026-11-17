import Link from "next/link";

type Tile = { id: string; name: string; slug: string; imageUrl: string | null };

/**
 * The single-row tile scroller on a category / sub-category page: a
 * full-bleed, freely-scrolling strip of tiles in one line (never wraps to
 * a second row — the scrollbar itself is hidden, the row just keeps
 * going), each a rounded-square image placeholder (emoji until a real
 * image is uploaded) with a short truncated label. Tile sizes ramp up
 * with the viewport. `hrefFor` builds each tile's destination (the next
 * taxonomy level down).
 */
export function SubcategoryScroller({
  items,
  hrefFor,
}: {
  items: Tile[];
  hrefFor: (slug: string) => string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 pl-2 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((tile) => (
        <Link
          key={tile.id}
          href={hrefFor(tile.slug)}
          className="flex shrink-0 flex-col items-center px-1.5"
        >
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-neutral-100 shadow-sm md:h-[88px] md:w-[88px] lg:h-24 lg:w-24">
            {tile.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- no image optimizer configured
              <img
                src={tile.imageUrl}
                alt={tile.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span aria-hidden="true" className="text-xl md:text-2xl">
                {tile.name.charAt(0)}
              </span>
            )}
          </div>
          <span className="mt-1.5 line-clamp-1 max-w-[64px] text-center text-[10px] font-semibold leading-tight text-ink md:max-w-[88px] md:text-xs lg:max-w-[96px] lg:text-[13px]">
            {tile.name}
          </span>
        </Link>
      ))}
    </div>
  );
}
