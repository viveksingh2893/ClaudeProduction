import { NextRequest } from "next/server";
import { requestOtp, lookupPhoneAccount, getTrustedClientIp } from "@kisan4u/auth";
import { requestOtpSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, withMobileApi } from "@/lib/mobile-api";
import { suspendedDealerResponse } from "@/lib/mobile-suspended-dealer";

/** Mirrors apps/web's requestDealerRegistrationOtpAction — blocks registration outright for a phone already belonging to a non-dealer account, and never creates a duplicate application for an existing dealer. */
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
    const phone = parsed.data.phone;
    const ip = getTrustedClientIp(req.headers);

    const lookup = await lookupPhoneAccount(phone);
    const suspended = await suspendedDealerResponse(lookup);
    if (suspended) return suspended;
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
      return jsonOk({ phone, alreadyDealer: true });
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

    const sent = await requestOtp(phone, { purpose: "dealer_registration", ip });
    if (!sent.ok)
      return sent.code === "RATE_LIMITED"
        ? jsonError(429, "RATE_LIMITED", sent.error, { retryAfter: sent.retryAfter })
        : jsonError(502, "SMS_SEND_FAILED", sent.error);
    return jsonOk({ phone, alreadyDealer: false });
  });
}
