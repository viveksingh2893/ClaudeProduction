"use server";

import { auth } from "@/auth";
import { requestOtp } from "@kisan4u/auth";
import { requestOtpSchema, referralCodeInputSchema } from "@kisan4u/validators";
import { applyReferralAtRegistration } from "@kisan4u/orders";
import { setReferralCookie, readReferralCookie, clearReferralCookie } from "@/lib/referral-cookie";
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
 * Customer login request returns the same result for every valid phone.
 * Account role/status is resolved only after OTP ownership is proven.
 */
export async function requestCustomerLoginOtpAction(
  phone: string,
  referralCode?: string,
): Promise<RequestOtpResult> {
  const parsed = requestOtpSchema.safeParse({ phone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid phone number" };
  }
  const normalizedPhone = parsed.data.phone;
  const ip = await currentClientIp();

  // Stash a BA referral code (from a shared link or the form field) so it
  // can be claimed right after a new account is created. Invalid/blank is
  // simply ignored later.
  const ref = referralCodeInputSchema.safeParse(referralCode ?? "");
  if (ref.success && typeof ref.data === "string" && ref.data.length > 0) {
    await setReferralCookie(ref.data);
  }

  const sent = await requestOtp(normalizedPhone, { purpose: "login", ip });
  if (!sent.ok) return otpFailure(sent);
  return {
    ok: true,
    redirectTo: `/login/otp?phone=${encodeURIComponent(normalizedPhone)}`,
  };
}

/**
 * Called by the OTP form right after a brand-new customer account signs in.
 * Attaches the stashed BA referral code (if any) to the account and accrues
 * the registration earning. Safe to call unconditionally — a missing code,
 * a disabled program, an already-attributed account or a self-referral are
 * all silent no-ops.
 */
export async function claimReferralAction(): Promise<{ attributed: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { attributed: false };
  const code = await readReferralCookie();
  await clearReferralCookie();
  if (!code) return { attributed: false };
  return applyReferralAtRegistration(session.user.id, code);
}
