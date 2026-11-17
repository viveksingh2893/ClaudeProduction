import { auth } from "@/auth";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getFullName } from "@kisan4u/db";
import { getCartItemCount, getUnreadNotificationCount } from "@kisan4u/orders";
import type { NavRole } from "@/lib/nav-links";
import { getGuestBuyerId } from "@/lib/guest-cart";
import { TopNav } from "./top-nav";

/**
 * Server wrapper mounted once in the root layout (apps/web/src/app/layout.tsx)
 * so every page gets the same navigation without each page resolving
 * session/cart state itself. Resolves role from the live session only —
 * never trusts anything client-supplied.
 *
 * A DEALER session whose profile isn't APPROVED yet (PENDING/REJECTED/
 * SUSPENDED) falls back to the guest link set — every dealer-specific page
 * (cart, orders, product requests) already redirects such a session to
 * /dealer/status, so showing those links would just be dead ends;
 * requirement is "do not expose links the current account cannot access."
 * A SELLER/ADMIN session landing on this customer-facing app (should not
 * normally happen — they belong on apps/dashboard) gets the same
 * conservative fallback.
 */
export async function SiteHeader() {
  const session = await auth();
  const sessionRole = session?.user.role;

  let role: NavRole = "GUEST";
  if (sessionRole === "CUSTOMER") {
    role = "CUSTOMER";
  } else if (sessionRole === "DEALER" && session) {
    const profile = await getDealerProfileForUser(session.user.id);
    role = profile?.status === "APPROVED" ? "DEALER" : "GUEST";
  }

  // A signed-out visitor who has started a guest cart still gets a live
  // cart badge (and can reach /cart) — see apps/web/src/lib/guest-cart.ts.
  const guestBuyerId = session ? null : await getGuestBuyerId();
  const cartOwnerId = role !== "GUEST" && session ? session.user.id : guestBuyerId;
  const cartCount = cartOwnerId ? await getCartItemCount(cartOwnerId) : 0;
  const unreadNotificationCount = role !== "GUEST" && session ? await getUnreadNotificationCount(session.user.id) : 0;

  return (
    <TopNav
      role={role}
      cartCount={cartCount}
      unreadNotificationCount={unreadNotificationCount}
      userName={(session?.user ? getFullName(session.user) : null) ?? null}
      isAuthenticated={Boolean(session)}
    />
  );
}
