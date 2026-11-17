import { NextRequest } from "next/server";
import {
  verifyOtp,
  requestOtp,
  createDealerOnboardingSession,
  lookupPhoneAccount,
  getTrustedClientIp,
} from "@kisan4u/auth";
import { verifyDealerOtpSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, withMobileApi } from "@/lib/mobile-api";

/**
 * Mirrors apps/web's verifyDealerOtpAction. Instead of an httpOnly cookie
 * (meaningless for a mobile client), the short-lived onboarding ticket id
 * is returned directly in the response body — same opaque, single-use,
 * 10-minute-TTL properties as the cookie, just carried by the app instead
 * of the browser's cookie jar. The client must submit it unchanged with
 * POST /dealer/register.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const body = await parseJsonBody(req);
    const parsed = verifyDealerOtpSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }
    const { phone, code } = parsed.data;
    const ip = getTrustedClientIp(req.headers);

    const otpOk = await verifyOtp(phone, code, { purpose: "dealer_registration", ip });
    if (!otpOk.ok)
      return jsonError(
        otpOk.code === "RATE_LIMITED" ? 429 : 401,
        otpOk.code === "RATE_LIMITED" ? "RATE_LIMITED" : "OTP_VERIFY_FAILED",
        otpOk.code === "RATE_LIMITED"
          ? "Too many incorrect codes. Please wait before trying again."
          : "Invalid or expired OTP. Please request a new one.",
        otpOk.code === "RATE_LIMITED" ? { retryAfter: otpOk.retryAfter } : undefined,
      );

    const lookup = await lookupPhoneAccount(phone);
    if (lookup.exists && lookup.role === "DEALER" && !lookup.isActive) {
      return jsonError(
        403,
        "ACCOUNT_DISABLED",
        "This dealer account has been disabled. Contact support.",
      );
    }
    if (lookup.exists && lookup.role === "DEALER") {
      const sent = await requestOtp(phone, { purpose: "login", ip });
      if (!sent.ok)
        return sent.code === "RATE_LIMITED"
          ? jsonError(429, "RATE_LIMITED", sent.error, { retryAfter: sent.retryAfter })
          : jsonError(502, "SMS_SEND_FAILED", sent.error);
      return jsonOk({ alreadyDealer: true, phone });
    }
    if (lookup.exists && lookup.role === "CUSTOMER") {
      return jsonError(
        400,
        "WRONG_ROLE",
        "This number is currently registered as a customer account.",
      );
    }
    if (lookup.exists) {
      return jsonError(400, "ALREADY_REGISTERED", "This phone number is already registered.");
    }

    const onboardingSessionId = await createDealerOnboardingSession(phone);
    return jsonOk({ alreadyDealer: false, onboardingSessionId });
  });
}
