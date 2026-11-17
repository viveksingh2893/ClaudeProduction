import Link from "next/link";
import type { BrandAssetDTO } from "@kisan4u/catalog";

/** Approved brands as a compact rail — square/contained logos, aspect ratio preserved. */
export function ShopByBrand({
  brands,
  hrefPrefix,
  title = "Shop by Brand",
}: {
  brands: BrandAssetDTO[];
  hrefPrefix: string;
  title?: string;
}) {
  if (brands.length === 0) return null;

  return (
    <section className="py-1">
      <h2 className="mb-3 px-4 text-[17px] font-bold tracking-tight text-ink md:px-6 md:text-lg lg:px-8">
        {title}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1 pl-4 pr-12 [scrollbar-width:none] md:pl-6 lg:pl-8 [&::-webkit-scrollbar]:hidden">
        {brands.map((b) => (
          <Link
            key={b.id}
            href={`${hrefPrefix}?brand=${b.slug}`}
            className="flex h-24 w-36 shrink-0 items-center justify-center rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-green-500 hover:shadow-card"
          >
            {b.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- no image optimizer/storage provider configured yet
              <img
                src={b.imageUrl}
                alt={b.name}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
              />
            ) : (
              <span className="text-center text-sm font-bold leading-tight text-ink">{b.name}</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
