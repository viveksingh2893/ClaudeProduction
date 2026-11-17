"use server";

import { requestOtp, lookupPhoneAccount } from "@kisan4u/auth";
import { requestOtpSchema } from "@kisan4u/validators";
import { currentClientIp } from "@/lib/client-ip";

type RequestOtpResult =
  { ok: true; redirectTo: string } | { ok: false; error: string; retryAfter?: number };

function otpFailure(result: Exclude<Awaited<ReturnType<typeof requestOtp>>, { ok: true }>) {
  return {
    ok: false as const,
    error: result.error,
    retryAfter: result.code === "RATE_LIMITED" ? result.retryAfter : undefined,
  };
}

/**
 * Dealer registration entry point (/register/dealer). The server checks
 * the phone against existing accounts before ever sending an OTP or
 * opening the application form:
 *  - already a DEALER: never re-show the registration form or create a
 *    second application — send the (one) OTP and route straight into
 *    the dealer login OTP step, which then routes by the dealer's
 *    current status.
 *  - already a CUSTOMER (or any other role): block registration entirely
 *    — no OTP, no form, no new/duplicate User or DealerProfile, and the
 *    existing role is never silently changed.
 */
export async function requestDealerRegistrationOtpAction(phone: string): Promise<RequestOtpResult> {
  const parsed = requestOtpSchema.safeParse({ phone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid phone number" };
  }
  const normalizedPhone = parsed.data.phone;
  const ip = await currentClientIp();

  const lookup = await lookupPhoneAccount(normalizedPhone);
  if (lookup.exists && lookup.role === "DEALER" && !lookup.isActive) {
    return { ok: false, error: "This dealer account has been disabled. Contact support." };
  }
  if (lookup.exists && lookup.role === "DEALER") {
    const sent = await requestOtp(normalizedPhone, { purpose: "login", ip });
    if (!sent.ok) return otpFailure(sent);
    return {
      ok: true,
      redirectTo: `/dealer/otp?phone=${encodeURIComponent(normalizedPhone)}&notice=already-dealer`,
    };
  }
  if (lookup.exists && lookup.role === "CUSTOMER") {
    return { ok: false, error: "This number is currently registered as a customer account." };
  }
  if (lookup.exists) {
    return { ok: false, error: "This phone number is already registered." };
  }

  const sent = await requestOtp(normalizedPhone, { purpose: "dealer_registration", ip });
  if (!sent.ok) return otpFailure(sent);
  return {
    ok: true,
    redirectTo: `/register/dealer/verify?phone=${encodeURIComponent(normalizedPhone)}`,
  };
}
