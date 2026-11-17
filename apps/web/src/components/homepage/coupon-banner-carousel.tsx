import Link from "next/link";
import { ScrollRow } from "@kisan4u/ui";
import type { PromotionalAssetDTO } from "@kisan4u/catalog";

/**
 * The row of small promo / coupon cards directly below the hero banner
 * (Flipkart-mobile build spec §2). A single horizontally-scrollable row of
 * fixed-width rounded cards — ~1.4 visible at a time so the next one
 * always peeks. Order is the admin's `priority` (see getActiveCouponBanners).
 */
export function CouponBannerCarousel({ banners }: { banners: PromotionalAssetDTO[] }) {
  if (banners.length === 0) return null;

  return (
    <ScrollRow
      ariaLabel="Offers and coupons"
      className="gap-3 py-3 pl-4 pr-1 md:pl-6 lg:pl-8 [scroll-padding-left:16px]"
      itemClassName="basis-[72%] sm:basis-[46%] lg:basis-[31%]"
    >
      {banners.map((banner) => (
        <CouponCard key={banner.id} banner={banner} />
      ))}
    </ScrollRow>
  );
}

function CouponCard({ banner }: { banner: PromotionalAssetDTO }) {
  const image = (
    <picture>
      {banner.mobileImageUrl && (
        <source media="(max-width: 640px)" srcSet={banner.mobileImageUrl} />
      )}
      <img
        src={banner.desktopImageUrl}
        alt={banner.altText}
        className="aspect-[2/1] w-full rounded-2xl object-cover"
        loading="lazy"
        decoding="async"
      />
    </picture>
  );

  if (!banner.linkUrl) return image;

  const isExternal = /^https?:\/\//i.test(banner.linkUrl);
  if (isExternal) {
    return (
      <a href={banner.linkUrl} rel="noopener noreferrer" className="block">
        {image}
      </a>
    );
  }

  return (
    <Link href={banner.linkUrl} className="block">
      {image}
    </Link>
  );
}
