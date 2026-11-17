import type { NextAuthConfig } from "next-auth";
import { sharedAuthConfig } from "@kisan4u/auth/src/shared";
import { buildAuthCookies } from "@kisan4u/auth/src/cookies";

/**
 * Edge-safe config used ONLY by middleware.ts. No providers here — the
 * OTP Credentials provider needs Prisma, which isn't Edge-runtime
 * compatible (uses real TCP via `pg`). Full config with providers lives
 * in ./auth.ts and only ever runs in a Node.js context (route handlers,
 * server components, server actions).
 *
 * `cookies` uses an app-specific prefix ("k4uweb") so this app's Auth.js
 * cookies never collide with apps/dashboard's ("k4udash") — both run on
 * `localhost` and browsers scope cookies by hostname only, not port. See
 * packages/auth/src/cookies.ts for the full rationale.
 */
export const authConfig: NextAuthConfig = {
  ...sharedAuthConfig,
  cookies: buildAuthCookies("k4uweb"),
  providers: [],
  pages: { signIn: "/login" },
};
