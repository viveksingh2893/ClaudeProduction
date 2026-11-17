import { NextRequest } from "next/server";
import { toggleWishlistItem, getSiteSettings } from "@kisan4u/catalog";
import { jsonError, jsonOk, requireMobileBuyerContext, withMobileApi } from "@/lib/mobile-api";

/** Toggle on/off — gated by SiteSettings.wishlistEnabled, same as apps/web's toggleWishlistAction. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const settings = await getSiteSettings();
    if (!settings.wishlistEnabled)
      return jsonError(403, "WISHLIST_DISABLED", "Wishlist is currently unavailable.");

    const { productId } = await params;
    const result = await toggleWishlistItem(buyer.userId, productId);
    return jsonOk(result);
  });
}
