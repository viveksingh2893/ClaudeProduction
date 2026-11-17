import { NextRequest, NextResponse } from "next/server";
import { requestOtp, lookupPhoneAccount, getTrustedClientIp } from "@kisan4u/auth";
import { requestOtpSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, withMobileApi } from "@/lib/mobile-api";
import { suspendedDealerResponse } from "@/lib/mobile-suspended-dealer";
import { usesGenericOtpFlow } from "@/lib/mobile-app-version";

/**
 * Sends an OTP for the given phone and tells the client which role to
 * verify with next — mirrors apps/web's requestCustomerLoginOtpAction
 * (apps/web/src/app/login/actions.ts): the server decides account type
 * from the database, never the client, so a dealer's phone is never
 * silently treated as a customer login attempt.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const body = await parseJsonBody(req);
    const parsed = requestOtpSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid phone number.",
      );
    }
    const { phone, purpose = "login" } = parsed.data;
    const otpContext = { purpose, ip: getTrustedClientIp(req.headers) };

    if (usesGenericOtpFlow(req.headers)) {
      const sent = await requestOtp(phone, otpContext);
      if (!sent.ok)
        return sent.code === "RATE_LIMITED"
          ? jsonError(429, "RATE_LIMITED", sent.error, { retryAfter: sent.retryAfter })
          : jsonError(502, "SMS_SEND_FAILED", sent.error);
      return jsonOk({ sent: true as const, phone });
    }

    // Compatibility response for older APKs and requests without a version
    // header. Remove after MOBILE_GENERIC_OTP_MIN_VERSION is enforced.
    const lookup = await lookupPhoneAccount(phone);
    const suspended = await suspendedDealerResponse(lookup);
    if (suspended) return suspended;
    if (lookup.exists && lookup.role === "DEALER") {
      const sent = await requestOtp(phone, otpContext);
      if (!sent.ok)
        return sent.code === "RATE_LIMITED"
          ? jsonError(429, "RATE_LIMITED", sent.error, { retryAfter: sent.retryAfter })
          : jsonError(502, "SMS_SEND_FAILED", sent.error);
      return jsonOk({ phone, resolvedRole: "DEALER" as const, isNewAccount: false });
    }
    if (lookup.exists && lookup.role === "CUSTOMER" && !lookup.isActive) {
      return jsonError(403, "ACCOUNT_DISABLED", "This account has been disabled. Contact support.");
    }
    if (lookup.exists && lookup.role !== "CUSTOMER" && lookup.role !== "DEALER") {
      return jsonError(
        400,
        "WRONG_LOGIN_METHOD",
        `This number belongs to a ${lookup.role.toLowerCase()} account, which logs in with email + password, not OTP.`,
      );
    }

    const sent = await requestOtp(phone, otpContext);
    if (!sent.ok)
      return sent.code === "RATE_LIMITED"
        ? jsonError(429, "RATE_LIMITED", sent.error, { retryAfter: sent.retryAfter })
        : jsonError(502, "SMS_SEND_FAILED", sent.error);
    return jsonOk({ phone, resolvedRole: "CUSTOMER" as const, isNewAccount: !lookup.exists });
  });
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
    { status: 405 },
  );
}
