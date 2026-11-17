import Link from "next/link";
import { ScrollRow } from "@kisan4u/ui";
import type { CropPestChip } from "@kisan4u/catalog";

/**
 * "Shop by Crop" / "Shop by Pest & Disease" one-line strip (Homepage
 * redesign phase B, restyled to the Flipkart/BigHaat mobile look): a bold
 * 17px header with a chevron affordance, then a horizontally-scrollable
 * row of circular image tiles with the name beneath each. The image is a
 * 1:1 background-removed PNG (enforced on upload — validateTagIconPng), so
 * it's contained with a little padding on the tile's green circle rather
 * than cropped to fill it; the emoji is only a placeholder until then.
 */
export function ShopByTagStrip({
  title,
  ariaLabel,
  items,
  hrefBase,
}: {
  title: string;
  ariaLabel: string;
  items: CropPestChip[];
  hrefBase: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="py-1">
      <div className="mb-3 flex items-center justify-between gap-3 px-4 md:px-6 lg:px-8">
        <h2 className="text-[17px] font-bold tracking-tight text-ink md:text-lg">{title}</h2>
      </div>
      <ScrollRow
        ariaLabel={ariaLabel}
        className="gap-3 pl-4 pr-10 md:pl-6 lg:pl-8"
        itemClassName="w-[22vw] max-w-[92px] md:w-[12vw] lg:w-[9vw]"
      >
        {items.map((item) => (
          <Link key={item.id} href={`${hrefBase}/${item.slug}`} className="group block text-center">
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-full bg-green-50 text-3xl">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- no image optimizer configured
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full object-contain p-1.5"
                  loading="lazy"
                />
              ) : item.emoji ? (
                <span aria-hidden="true">{item.emoji}</span>
              ) : (
                <span className="text-xs font-semibold text-gray-400">
                  {item.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <span className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-tight text-ink">
              {item.name}
            </span>
          </Link>
        ))}
      </ScrollRow>
    </section>
  );
}
