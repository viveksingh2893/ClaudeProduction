import { NextRequest } from "next/server";
import {
  createMobileSessionTokenPair,
  getUserBasicInfo,
  mobileDeviceFromHeaders,
} from "@kisan4u/auth";
import { createGuestUser } from "@/lib/guest-cart";
import { jsonError, jsonOk, withMobileApi } from "@/lib/mobile-api";

/**
 * Start a guest browsing session. The app calls this once when it has no
 * stored tokens — it gets a bearer token pair for a bare `isGuest`
 * placeholder User (role CUSTOMER, no phone) so the same cart / catalogue
 * / checkout-preview endpoints work unchanged. Browsing only ever shows
 * the customer catalogue (an APPROVED dealer is the only thing
 * resolveCatalogViewer upgrades to DEALER — a guest never is). The
 * order-placing routes reject `isGuest` and the app then runs the
 * mobile-number OTP verify, which claims this guest's cart onto the real
 * account (see /api/mobile/v1/auth/otp/verify). Mirrors apps/web's
 * cookie-based guest cart (apps/web/src/lib/guest-cart.ts).
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const guest = await createGuestUser();
    const user = await getUserBasicInfo(guest.id);
    if (!user) return jsonError(500, "INTERNAL_ERROR", "Could not start a guest session.");

    const tokens = await createMobileSessionTokenPair(
      { uid: user.id, role: user.role, sessionVersion: guest.sessionVersion },
      mobileDeviceFromHeaders(req.headers),
    );

    return jsonOk(
      {
        ...tokens,
        isGuest: true,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isGuest: true,
        },
      },
      201,
    );
  });
}
