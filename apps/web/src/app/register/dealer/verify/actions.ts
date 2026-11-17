"use server";

import { cookies } from "next/headers";
import {
  verifyOtp,
  requestOtp,
  createDealerOnboardingSession,
  lookupPhoneAccount,
} from "@kisan4u/auth";
import { verifyDealerOtpSchema } from "@kisan4u/validators";
import { DEALER_ONBOARDING_COOKIE, DEALER_ONBOARDING_MAX_AGE_SECONDS } from "../onboarding-cookie";
import { currentClientIp } from "@/lib/client-ip";

type VerifyResult = { ok: true; redirectTo: string } | { ok: false; error: string };

export async function verifyDealerOtpAction(input: {
  phone: string;
  code: string;
}): Promise<VerifyResult> {
  const parsed = verifyDealerOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { phone, code } = parsed.data;
  const ip = await currentClientIp();

  // Single source of truth for OTP verification/consumption — nothing
  // downstream (the details form, the final submit) re-checks the code.
  const otpOk = await verifyOtp(phone, code, { purpose: "dealer_registration", ip });
  if (!otpOk.ok) {
    return { ok: false, error: "Invalid or expired OTP. Please request a new one." };
  }

  // Race-condition safety net: the initial /register/dealer submit
  // already checked this before an OTP was ever sent, so this only fires
  // if the phone's account was created/changed between that check and
  // this verification (e.g. two tabs). Existing dealer records are
  // routed by their current status, not shown a new-application form —
  // a fresh OTP is sent (this one was just consumed above) and the user
  // is routed straight into the dealer login OTP step, where /account's
  // status gate (-> /dealer/status) already handles PENDING/REJECTED/
  // SUSPENDED/APPROVED correctly. A phone that turned out to belong to a
  // customer (or anything else) is blocked outright — never silently
  // logged in as a dealer, never a new/duplicate account created.
  const lookup = await lookupPhoneAccount(phone);
  if (lookup.exists && lookup.role === "DEALER" && !lookup.isActive) {
    return { ok: false, error: "This dealer account has been disabled. Contact support." };
  }
  if (lookup.exists && lookup.role === "DEALER") {
    const sent = await requestOtp(phone, { purpose: "login", ip });
    if (!sent.ok) return { ok: false, error: sent.error };
    return {
      ok: true,
      redirectTo: `/dealer/otp?phone=${encodeURIComponent(phone)}&notice=already-dealer`,
    };
  }
  if (lookup.exists && lookup.role === "CUSTOMER") {
    return { ok: false, error: "This number is currently registered as a customer account." };
  }
  if (lookup.exists) {
    return { ok: false, error: "This phone number is already registered." };
  }

  const onboardingSessionId = await createDealerOnboardingSession(phone);
  const cookieStore = await cookies();
  cookieStore.set(DEALER_ONBOARDING_COOKIE, onboardingSessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/register/dealer",
    maxAge: DEALER_ONBOARDING_MAX_AGE_SECONDS,
  });

  return { ok: true, redirectTo: "/register/dealer/details" };
}
