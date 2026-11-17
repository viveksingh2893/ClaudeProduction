import { prisma } from "@kisan4u/db";

export type PosOrderContext =
  | { ok: true; role: "CUSTOMER"; dealerState: null; dealerProfileId: null }
  | { ok: true; role: "DEALER"; dealerState: { id: string; name: string }; dealerProfileId: string }
  | { ok: false; error: string };

/**
 * The single authoritative source of "who is this POS order for, and what
 * role/state applies" — re-derived fresh from the database on EVERY call,
 * never taken from anything the POS client claims about the selected
 * customer/dealer (spec §4/§9/§10: catalogue, pricing, and address-state
 * rules all follow from this, and none of it may be spoofable via a
 * manipulated request). Every POS server action that touches address,
 * catalogue, cart, or checkout calls this again itself — it is cheap (one
 * indexed query) and each action must independently prove eligibility
 * rather than trust a sibling action already did.
 *
 * A dealer must be APPROVED and have a verified state to be usable at
 * all — anything else (PENDING/REJECTED/SUSPENDED/INACTIVE, or APPROVED
 * with no stateId) fails closed with an explanatory error, mirroring
 * resolveCheckoutAddress's own dealerState requirement (packages/orders/
 * src/checkout-address.ts) so POS and the storefront can never disagree
 * about whether a dealer is order-eligible.
 */
export async function resolvePosOrderContext(targetUserId: string): Promise<PosOrderContext> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      role: true,
      isActive: true,
      dealerProfile: {
        select: { id: true, status: true, stateId: true, indianState: { select: { name: true } } },
      },
    },
  });

  if (!user) return { ok: false, error: "Account not found." };
  if (!user.isActive) return { ok: false, error: "This account has been deactivated." };

  if (user.role === "CUSTOMER") {
    return { ok: true, role: "CUSTOMER", dealerState: null, dealerProfileId: null };
  }

  if (user.role === "DEALER") {
    const profile = user.dealerProfile;
    if (!profile || profile.status !== "APPROVED") {
      return {
        ok: false,
        error: "This dealer is not approved and cannot be used for a POS order.",
      };
    }
    if (!profile.stateId || !profile.indianState) {
      return {
        ok: false,
        error:
          "This dealer has no verified state on file. Correct it from Admin → Dealers before ordering.",
      };
    }
    return {
      ok: true,
      role: "DEALER",
      dealerState: { id: profile.stateId, name: profile.indianState.name },
      dealerProfileId: profile.id,
    };
  }

  return { ok: false, error: "The selected account is neither a customer nor a dealer." };
}
