"use server";

import { requestOtp, lookupPhoneAccount } from "@kisan4u/auth";
import { requestOtpSchema } from "@kisan4u/validators";
import { currentClientIp } from "@/lib/client-ip";

type RequestOtpResult =
  | { ok: true; redirectTo?: string; notRegistered?: boolean }
  | { ok: false; error: string; retryAfter?: number };

function otpFailure(result: Exclude<Awaited<ReturnType<typeof requestOtp>>, { ok: true }>) {
  return {
    ok: false as const,
    error: result.error,
    retryAfter: result.code === "RATE_LIMITED" ? result.retryAfter : undefined,
  };
}

/**
 * Dealer login entry point (/dealer/otp phone step). The server decides
 * account type from the database before sending any OTP — a phone
 * number that already belongs to a customer/CUSTOMER is never logged in
 * as a dealer; it's routed to the customer OTP flow instead (with the OTP
 * already sent, so the user only ever verifies one code).
 *
 * A phone with no account at all still gets an OTP sent (so the user
 * doesn't have to re-enter it on a separate registration page) — the
 * `notRegistered` flag tells the client to show a "you're not a dealer
 * yet" notice and, on verify, to call `verifyDealerOtpAction` (the
 * registration flow's own verify step, see ../register/dealer/verify/actions.ts)
 * instead of signing in, so a successful verification lands the user on
 * the registration form rather than failing a login that can't succeed.
 */
export async function requestDealerLoginOtpAction(phone: string): Promise<RequestOtpResult> {
  const parsed = requestOtpSchema.safeParse({ phone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid phone number" };
  }
  const normalizedPhone = parsed.data.phone;
  const ip = await currentClientIp();

  const lookup = await lookupPhoneAccount(normalizedPhone);
  if (lookup.exists && lookup.role === "CUSTOMER") {
    const sent = await requestOtp(normalizedPhone, { purpose: "login", ip });
    if (!sent.ok) return otpFailure(sent);
    return {
      ok: true,
      redirectTo: `/login/otp?phone=${encodeURIComponent(normalizedPhone)}&notice=customer`,
    };
  }
  if (lookup.exists && lookup.role === "DEALER" && !lookup.isActive) {
    return { ok: false, error: "This dealer account has been disabled. Contact support." };
  }
  if (!lookup.exists) {
    const sent = await requestOtp(normalizedPhone, { purpose: "dealer_registration", ip });
    if (!sent.ok) return otpFailure(sent);
    return { ok: true, notRegistered: true };
  }

  const sent = await requestOtp(normalizedPhone, { purpose: "login", ip });
  if (!sent.ok) return otpFailure(sent);
  return { ok: true };
}
