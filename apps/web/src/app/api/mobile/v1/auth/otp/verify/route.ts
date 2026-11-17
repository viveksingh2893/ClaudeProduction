import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import {
  createMobileSessionTokenPair,
  getTrustedClientIp,
  mobileDeviceFromHeaders,
  verifyOtpAndResolveUser,
} from "@kisan4u/auth";
import { applyReferralAtRegistration } from "@kisan4u/orders";
import { mobileVerifyOtpWithNameSchema, referralCodeInputSchema } from "@kisan4u/validators";
import { claimGuestCart, discardGuestCart } from "@/lib/guest-cart";
import {
  jsonError,
  jsonOk,
  optionalMobileAuth,
  parseJsonBody,
  withMobileApi,
} from "@/lib/mobile-api";

export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    // A guest-browsing session carries a bearer token for an `isGuest`
    // placeholder. Once OTP resolves the real account, customer sessions
    // claim that cart; dealer sessions discard it because dealers have a
    // separate cart and the buyer confirmed that consequence inline.
    const caller = await optionalMobileAuth(req);
    const guestUserId = caller
      ? (
          await prisma.user.findUnique({
            where: { id: caller.userId },
            select: { id: true, isGuest: true },
          })
        )?.isGuest
        ? caller.userId
        : null
      : null;

    const body = await parseJsonBody(req);
    const parsed = mobileVerifyOtpWithNameSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }
    const { phone, code, role, name, purpose = "login" } = parsed.data;

    const result = await verifyOtpAndResolveUser(phone, code, role, name, {
      purpose,
      ip: getTrustedClientIp(req.headers),
    });
    // 400, not 401: a wrong/expired code is a bad request, not an invalid
    // session — the app's api-client treats a 401 on an authed call as
    // "session gone" and would wipe the guest token mid-verify.
    if (!result.ok)
      return result.code === "RATE_LIMITED"
        ? jsonError(429, "RATE_LIMITED", result.error, { retryAfter: result.retryAfter })
        : jsonError(400, "OTP_VERIFY_FAILED", result.error);

    let claimedCartItems = 0;
    if (guestUserId && guestUserId !== result.user.id) {
      if (result.user.role === "DEALER") {
        await discardGuestCart(guestUserId);
      } else {
        claimedCartItems = await claimGuestCart(guestUserId, result.user.id);
      }
    }

    // Attach a BA referral code for a brand-new account (from the login
    // form field or a `kisan4u://r/<code>` deep link). Silent no-op for a
    // blank/invalid code, a disabled program, or an existing account.
    if (result.isNewAccount) {
      const ref = referralCodeInputSchema.safeParse(
        (body as { referralCode?: unknown }).referralCode ?? "",
      );
      if (ref.success && typeof ref.data === "string" && ref.data.length > 0) {
        await applyReferralAtRegistration(result.user.id, ref.data).catch(() => {});
      }
    }

    const tokens = await createMobileSessionTokenPair(
      {
        uid: result.user.id,
        role: result.user.role,
        sessionVersion: result.user.sessionVersion,
      },
      mobileDeviceFromHeaders(req.headers),
    );

    return jsonOk({
      ...tokens,
      isNewAccount: result.isNewAccount,
      claimedCartItems,
      user: {
        id: result.user.id,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        isGuest: false,
      },
    });
  });
}
