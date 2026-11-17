import "server-only";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getCartItemCount } from "@kisan4u/orders";
import { auth } from "@/auth";
import { getGuestBuyerId } from "@/lib/guest-cart";

/**
 * The storefront cart badge count for whoever the current request is —
 * a signed-in customer / approved dealer, or a signed-out visitor who has
 * started a guest cart. Same resolution SiteHeader already does for its
 * own badge (session → approved-dealer → guest cookie), factored out so
 * the mobile bottom tab bar (BottomNav in layout.tsx) shows the same
 * number without re-deriving it.
 */
export async function getStorefrontCartCount(): Promise<number> {
  const session = await auth();

  if (session?.user.role === "CUSTOMER") {
    return getCartItemCount(session.user.id);
  }
  if (session?.user.role === "DEALER") {
    const profile = await getDealerProfileForUser(session.user.id);
    return profile?.status === "APPROVED" ? getCartItemCount(session.user.id) : 0;
  }
  if (session) return 0; // SELLER/ADMIN on the storefront — no buyer cart

  const guestBuyerId = await getGuestBuyerId();
  return guestBuyerId ? getCartItemCount(guestBuyerId) : 0;
}
