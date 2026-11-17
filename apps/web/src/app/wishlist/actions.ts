"use server";

import { revalidatePath } from "next/cache";
import { toggleWishlistItem, getSiteSettings } from "@kisan4u/catalog";
import { requireBuyerContext } from "@/lib/buyer-context";
import { metaTrackingAllowed } from "@/lib/meta/consent";
import { metaProductInfo, type MetaProductInfo } from "@/lib/meta/product-data";

type Result =
  | { ok: true; wishlisted: boolean; meta: MetaProductInfo | null }
  | { ok: false; error: string };

/** Gated by SiteSettings.wishlistEnabled — the actual toggle stays a pure, flag-unaware function (see packages/catalog/src/wishlist.ts's doc comment). */
export async function toggleWishlistAction(productId: string): Promise<Result> {
  const ctx = await requireBuyerContext();
  const settings = await getSiteSettings();
  if (!settings.wishlistEnabled) return { ok: false, error: "Wishlist is currently unavailable." };

  const result = await toggleWishlistItem(ctx.userId, productId);
  revalidatePath("/wishlist");
  // SKU / price for the caller's Meta "AddToWishlist" event — only on add.
  const meta =
    result.wishlisted && (await metaTrackingAllowed())
      ? await metaProductInfo(productId, null, ctx.role)
      : null;
  return { ok: true, wishlisted: result.wishlisted, meta };
}
