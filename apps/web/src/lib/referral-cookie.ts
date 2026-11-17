import { cookies } from "next/headers";

/**
 * Carries a BA referral code from a shared link (`/r/<CODE>`) through the
 * login / OTP flow so it can be attached to a brand-new account right after
 * it is created. Short-lived, not signed — a wrong or stale code simply
 * fails to resolve to an active BA and is ignored (see
 * @kisan4u/orders applyReferralAtRegistration).
 */
export const REFERRAL_COOKIE = "k4u_ref";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export async function setReferralCookie(code: string): Promise<void> {
  const store = await cookies();
  store.set(REFERRAL_COOKIE, code.trim().toUpperCase(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readReferralCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFERRAL_COOKIE)?.value ?? null;
}

export async function clearReferralCookie(): Promise<void> {
  const store = await cookies();
  store.delete(REFERRAL_COOKIE);
}
