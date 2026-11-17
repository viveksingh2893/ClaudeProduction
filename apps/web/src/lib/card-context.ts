import { getSiteSettings, getWishlistedProductIds } from "@kisan4u/catalog";
import { getDbLanguage } from "@/i18n/server";
import type { CardFeatureFlags } from "./product-card-adapter";

/**
 * One batched fetch per page render (never one per card — see
 * packages/catalog/src/wishlist.ts's getWishlistedProductIds doc comment)
 * for everything the unified ProductCard needs beyond the product row
 * itself: global feature toggles, the rating-display threshold, which of
 * the listed products this viewer has wishlisted, and the viewer's
 * content language (so card adapters localize the product name).
 */
export async function getCardContext(userId: string | null, productIds: string[]) {
  const [settings, wishlistedIds, language] = await Promise.all([
    getSiteSettings(),
    userId ? getWishlistedProductIds(userId, productIds) : Promise.resolve(new Set<string>()),
    getDbLanguage(),
  ]);
  const siteSettings: CardFeatureFlags = {
    wishlistEnabled: settings.wishlistEnabled,
    buyNowEnabled: settings.buyNowEnabled,
    addToCartEnabled: settings.addToCartEnabled,
  };
  return {
    siteSettings,
    ratingThreshold: settings.ratingDisplayThreshold,
    wishlistedIds,
    language,
  };
}
