import type { PromotionalAssetDTO } from "@kisan4u/catalog";
import { BannerCarousel } from "./banner-carousel";

/**
 * The first thing on a category page: that category's banner carousel.
 * When one or more banners are assigned to the category (admin → Banners →
 * "Belongs to"), they render through the *same* <BannerCarousel> the home
 * page hero uses — identical component, identical props, identical 2:1
 * slide / peek / progress-dot / autoplay behaviour. When none is assigned
 * yet, a category-branded placeholder fills the same slot so the page
 * still opens on a banner of that category rather than a bare heading.
 */
export function CategoryHero({
  banners,
  categoryName,
  emoji,
}: {
  banners: PromotionalAssetDTO[];
  categoryName: string;
  emoji: string | null;
}) {
  if (banners.length > 0) {
    return <BannerCarousel banners={banners} />;
  }

  return (
    <div className="px-4 pt-3 md:px-6 lg:px-8">
      <div className="flex aspect-[2/1] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-green-600 to-green-800 px-6 text-center text-white">
        {emoji && (
          <span aria-hidden="true" className="text-5xl sm:text-6xl">
            {emoji}
          </span>
        )}
        <span className="text-xl font-extrabold tracking-tight sm:text-2xl">{categoryName}</span>
        <span className="text-xs text-white/80 sm:text-sm">Explore everything in {categoryName}</span>
      </div>
    </div>
  );
}
