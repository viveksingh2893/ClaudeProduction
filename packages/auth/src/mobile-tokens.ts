import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@kisan4u/db";

/**
 * Bearer-token auth for the Android/iOS clients only. Completely separate
 * from the cookie-based NextAuth sessions apps/web and apps/dashboard use
 * (see packages/auth/src/shared.ts) — a mobile client can't participate in
 * a browser cookie jar, so it gets its own signed JWT pair instead. Both
 * carry the exact same identity/revocation shape (`uid`/`role`/
 * `sessionVersion`) as the NextAuth JWT so the existing
 * `validateUserSession` revocation check (packages/auth/src/access.ts)
 * works unmodified for mobile requests too — an admin suspending a dealer
 * invalidates their mobile session on the very next API call, exactly like
 * it does for the website.
 */

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): Uint8Array {
  const secret = process.env.MOBILE_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "MOBILE_AUTH_SECRET is not set. Add it to apps/web/.env.local (see .env.example) — it must differ from AUTH_SECRET.",
    );
  }
  return new TextEncoder().encode(secret);
}

export type MobileTokenPayload = {
  uid: string;
  role: UserRole;
  sessionVersion: number;
  sessionId?: string;
  refreshTokenId?: string;
};

export type MobileTokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

async function signMobileToken(
  payload: MobileTokenPayload,
  typ: "access" | "refresh",
  ttlSeconds: number,
) {
  return new SignJWT({
    uid: payload.uid,
    role: payload.role,
    sessionVersion: payload.sessionVersion,
    typ,
    ...(payload.sessionId ? { sid: payload.sessionId } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .setJti(payload.refreshTokenId ?? crypto.randomUUID())
    .sign(getSecret());
}

export function signMobileAccessToken(payload: MobileTokenPayload): Promise<string> {
  return signMobileToken(payload, "access", ACCESS_TOKEN_TTL_SECONDS);
}

export function signMobileRefreshToken(payload: MobileTokenPayload): Promise<string> {
  return signMobileToken(payload, "refresh", REFRESH_TOKEN_TTL_SECONDS);
}

/** Issues a fresh access+refresh pair — called at login and on every refresh (refresh token rotates too, so a leaked-and-replaced refresh token stops working). */
export async function issueMobileTokenPair(payload: MobileTokenPayload): Promise<MobileTokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signMobileAccessToken(payload),
    signMobileRefreshToken(payload),
  ]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export type VerifiedMobileToken = Omit<MobileTokenPayload, "sessionId" | "refreshTokenId"> & {
  typ: "access" | "refresh";
  sessionId: string | null;
  refreshTokenId: string | null;
  legacy: boolean;
};

export function legacyMobileTokensAllowed(now = Date.now()): boolean {
  const raw = process.env.MOBILE_LEGACY_TOKEN_CUTOFF?.trim();
  if (!raw) return true;
  const cutoff = Date.parse(raw);
  return Number.isFinite(cutoff) && now < cutoff;
}

async function verifyMobileToken(
  token: string,
  expectedTyp: "access" | "refresh",
): Promise<VerifiedMobileToken | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.typ !== expectedTyp) return null;
    if (
      typeof payload.uid !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.sessionVersion !== "number"
    ) {
      return null;
    }
    const sessionId = typeof payload.sid === "string" ? payload.sid : null;
    const refreshTokenId = typeof payload.jti === "string" ? payload.jti : null;
    const legacy = sessionId === null;
    if (legacy && !legacyMobileTokensAllowed()) return null;
    if (!legacy && expectedTyp === "refresh" && !refreshTokenId) return null;
    return {
      uid: payload.uid,
      role: payload.role as UserRole,
      sessionVersion: payload.sessionVersion,
      typ: expectedTyp,
      sessionId,
      refreshTokenId,
      legacy,
    };
  } catch {
    return null;
  }
}

export function verifyMobileAccessToken(token: string): Promise<VerifiedMobileToken | null> {
  return verifyMobileToken(token, "access");
}

export function verifyMobileRefreshToken(token: string): Promise<VerifiedMobileToken | null> {
  return verifyMobileToken(token, "refresh");
}
