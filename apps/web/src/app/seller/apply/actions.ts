"use server";

import { cookies } from "next/headers";
import {
  registerSeller,
  requestOtp,
  verifyOtp,
  lookupPhoneAccount,
  issuePhoneVerificationToken,
  createSellerOnboardingSession,
  getVerifiedPhoneForSellerOnboardingSession,
  sellerOnboardingOwnsDocuments,
  consumeSellerOnboardingSession,
  type RegistrationResult,
} from "@kisan4u/auth";
import { requestOtpSchema, sellerRegistrationSchema, verifyOtpSchema } from "@kisan4u/validators";
import type { SellerRegistrationInput } from "@kisan4u/validators";
import { currentClientIp } from "@/lib/client-ip";
import { SELLER_ONBOARDING_COOKIE, SELLER_ONBOARDING_MAX_AGE_SECONDS } from "./onboarding-cookie";

export async function registerSellerAction(
  input: SellerRegistrationInput,
): Promise<RegistrationResult> {
  const parsed = sellerRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const validated = parsed.data;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SELLER_ONBOARDING_COOKIE)?.value;
  if (!sessionId) {
    return { ok: false, error: "Your verification session has expired. Please start again." };
  }
  const phone = await getVerifiedPhoneForSellerOnboardingSession(sessionId);
  if (!phone || phone !== validated.mobileNumber) {
    return { ok: false, error: "Your verification session has expired. Please start again." };
  }
  if (
    !(await sellerOnboardingOwnsDocuments(sessionId, [validated.gstDocUrl, validated.panDocUrl]))
  ) {
    return { ok: false, error: "Upload both documents again from this verified application." };
  }
  const result = await registerSeller(validated);
  if (result.ok) {
    await consumeSellerOnboardingSession(sessionId);
    cookieStore.delete(SELLER_ONBOARDING_COOKIE);
  }
  return result;
}

type OtpResult = { ok: true } | { ok: false; error: string; retryAfter?: number };
type VerifyResult = { ok: true; token: string } | { ok: false; error: string };

/**
 * Seller application phone check — same shape as guest checkout's
 * requestGuestOtpAction: the server rejects a number that already belongs
 * to any account (registerSeller would reject it anyway) before an OTP is
 * ever sent, then sends the code via the shared OTP infra.
 */
export async function requestSellerApplyOtpAction(rawPhone: unknown): Promise<OtpResult> {
  const parsed = requestOtpSchema.safeParse({ phone: rawPhone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid mobile number." };
  }
  const phone = parsed.data.phone;

  const lookup = await lookupPhoneAccount(phone);
  if (lookup.exists) {
    return {
      ok: false,
      error:
        "An account already exists for this mobile number. Sign in on the Kisan4U Dashboard instead.",
    };
  }

  const sent = await requestOtp(phone, { purpose: "seller_apply", ip: await currentClientIp() });
  if (!sent.ok) {
    return {
      ok: false,
      error: sent.error,
      retryAfter: sent.code === "RATE_LIMITED" ? sent.retryAfter : undefined,
    };
  }
  return { ok: true };
}

/**
 * Verifies the 6-digit code (single-use — consumed here) and, on success,
 * returns a short-lived signed ticket the form submits back with the rest
 * of the application; registerSeller requires it and checks it matches the
 * submitted mobile number. Mirrors guest checkout, where signIn("otp")
 * both consumes the code and produces the proof (a session) in one step.
 */
export async function verifySellerApplyOtpAction(input: {
  phone: unknown;
  code: unknown;
}): Promise<VerifyResult> {
  const parsed = verifyOtpSchema
    .pick({ phone: true, code: true })
    .safeParse({ phone: input.phone, code: input.code });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter the 6-digit code." };
  }
  const { phone, code } = parsed.data;

  const ip = await currentClientIp();
  const ok = await verifyOtp(phone, code, { purpose: "seller_apply", ip });
  if (!ok.ok) {
    return { ok: false, error: "That code didn't work — check it and try again, or resend." };
  }

  const lookup = await lookupPhoneAccount(phone);
  if (lookup.exists) {
    return {
      ok: false,
      error: "An account already exists for this mobile number.",
    };
  }

  const sessionId = await createSellerOnboardingSession(phone, ip);
  const cookieStore = await cookies();
  cookieStore.set(SELLER_ONBOARDING_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/seller/apply",
    maxAge: SELLER_ONBOARDING_MAX_AGE_SECONDS,
  });
  return { ok: true, token: await issuePhoneVerificationToken(phone) };
}
