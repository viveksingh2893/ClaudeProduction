import { SignJWT, jwtVerify } from "jose";

/**
 * A short-lived, signed "this phone number was just OTP-verified" ticket.
 *
 * Used by flows that verify a phone by OTP but do NOT create a session at
 * that moment — the seller application form (apps/web/src/app/seller/apply):
 * the visitor isn't signed in, and no account exists to sign into yet
 * (registerSeller creates a PENDING one). The OTP itself is single-use and
 * consumed at verify time, so the final submit can't re-check it; instead
 * verifySellerApplyOtpAction hands back one of these tokens and
 * registerSeller requires it, checking the embedded phone matches the
 * submitted mobile number.
 *
 * Signed with AUTH_SECRET (same key the NextAuth cookie uses) — a forged
 * or tampered token fails verification. 15-minute TTL: long enough to fill
 * in the rest of the form, short enough that a leaked token is nearly
 * worthless.
 */

const TTL_SECONDS = 15 * 60;
const PURPOSE = "phone-verify";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — required to sign phone-verification tokens.");
  }
  return new TextEncoder().encode(secret);
}

export async function issuePhoneVerificationToken(phone: string): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, phone })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(getSecret());
}

/** Returns the verified phone number, or null if the token is missing/forged/expired/wrong-purpose. */
export async function verifyPhoneVerificationToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.purpose !== PURPOSE || typeof payload.phone !== "string") return null;
    return payload.phone;
  } catch {
    return null;
  }
}
