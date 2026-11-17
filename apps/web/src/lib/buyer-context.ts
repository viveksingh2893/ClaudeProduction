import { redirect } from "next/navigation";
import { prisma } from "@kisan4u/db";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { auth } from "@/auth";
import { requireSession } from "./session-guard";
import { getGuestBuyerId } from "./guest-cart";

export type BuyerContext = {
  userId: string;
  role: "CUSTOMER" | "DEALER";
  /** The dealer's own verified state, resolved from the normalized IndianState row — never the free-text DealerProfile.state, and never anything client-supplied (Phase 4 spec §A/§C2). Null for a customer, or an approved dealer with no normalized state yet. */
  dealerState: { id: string; name: string } | null;
  /** True only for a not-signed-in visitor browsing/checking out against a
   * placeholder account (see apps/web/src/lib/guest-cart.ts). Always CUSTOMER
   * pricing; can fill a cart and reach the checkout page, but the order
   * itself is gated on OTP-verifying a mobile number first. */
  isGuest: boolean;
};

/**
 * The single place cart/checkout/address code resolves "who is buying and
 * under what rules" — never trusts a client-supplied customer type (§A).
 * A dealer must be APPROVED to reach any of these pages at all.
 *
 * `allowGuest` (cart + checkout-page render + the guest OTP flow only):
 * when there is no session, fall back to the signed guest-cart cookie
 * instead of redirecting to /login. Order placement never passes this —
 * placeOrderAction calls requireBuyerContext() with no options, so a
 * guest is bounced there regardless of the button state.
 */
export async function requireBuyerContext(
  opts: { allowGuest?: boolean } = {},
): Promise<BuyerContext> {
  if (opts.allowGuest) {
    const maybeSession = await auth();
    if (!maybeSession?.user) {
      const guestId = await getGuestBuyerId();
      if (guestId) {
        return { userId: guestId, role: "CUSTOMER", dealerState: null, isGuest: true };
      }
      redirect("/products");
    }
  }

  const session = await requireSession(["CUSTOMER", "DEALER"]);

  if (session.user.role === "DEALER") {
    const profile = await getDealerProfileForUser(session.user.id);
    if (!profile) redirect("/login");
    if (profile.status !== "APPROVED") redirect("/dealer/status");
    const dealerState = profile.stateId
      ? await prisma.indianState.findUnique({
          where: { id: profile.stateId },
          select: { id: true, name: true },
        })
      : null;
    return { userId: session.user.id, role: "DEALER", dealerState, isGuest: false };
  }

  return { userId: session.user.id, role: "CUSTOMER", dealerState: null, isGuest: false };
}

/**
 * Best-effort delivery state for a CUSTOMER, used for cart/checkout-preview
 * selling-licence enforcement before a specific checkout address has been
 * chosen — this storefront has no pre-checkout "deliver to" location
 * picker (spec §13's own fallback: "if the customer's state is not yet
 * known ... follow the existing location/address-selection design"), so
 * the closest real signal is their saved default address, if any. Null
 * when none exists yet — the real checkout transaction (packages/orders/
 * src/checkout.ts) always resolves the actual submitted address first and
 * is the authoritative, always-enforced gate regardless of this.
 */
export async function resolveDefaultCustomerStateId(userId: string): Promise<string | null> {
  const defaultAddress = await prisma.customerAddress.findFirst({
    where: { userId, isDefault: true },
    select: { stateId: true },
  });
  return defaultAddress?.stateId ?? null;
}
