import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe (no Prisma) — builds an Auth.js `cookies` config with names
 * unique to one app. Without this, apps/web and apps/dashboard both fall
 * back to Auth.js's unconfigured defaults (`authjs.session-token`,
 * `authjs.csrf-token`, `authjs.callback-url`, ...) — identical names on
 * both apps. Browser cookies are scoped by hostname only, not port, so
 * `localhost:3000` and `localhost:3001` share one cookie slot per name:
 * logging in/out on one app silently overwrites the other app's session.
 *
 * `secure` is derived from NODE_ENV, never hardcoded — per-cookie
 * `__Secure-`/`__Host-` prefixes only ever apply when secure is true, so
 * plain HTTP localhost dev never gets them (matches Auth.js's own default
 * behavior in `defaultCookies()`, just with an app-specific base name
 * instead of the shared `authjs` one).
 */
export function buildAuthCookies(appPrefix: string): NonNullable<NextAuthConfig["cookies"]> {
  const secure = process.env.NODE_ENV === "production";
  const securePrefix = secure ? "__Secure-" : "";
  const hostPrefix = secure ? "__Host-" : "";

  return {
    sessionToken: {
      name: `${securePrefix}${appPrefix}.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
    callbackUrl: {
      name: `${securePrefix}${appPrefix}.callback-url`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
    csrfToken: {
      // __Host- (stricter than __Secure-) for the CSRF cookie, matching
      // Auth.js's own default convention.
      name: `${hostPrefix}${appPrefix}.csrf-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
    pkceCodeVerifier: {
      name: `${securePrefix}${appPrefix}.pkce.code_verifier`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 60 * 15 },
    },
    state: {
      name: `${securePrefix}${appPrefix}.state`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 60 * 15 },
    },
    nonce: {
      name: `${securePrefix}${appPrefix}.nonce`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
    webauthnChallenge: {
      name: `${securePrefix}${appPrefix}.challenge`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 60 * 15 },
    },
  };
}
