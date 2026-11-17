import type { NextAuthConfig } from "next-auth";
import { sharedAuthConfig } from "@kisan4u/auth/src/shared";
import { buildAuthCookies } from "@kisan4u/auth/src/cookies";

/**
 * Edge-safe config used ONLY by middleware.ts. No providers here — the
 * password Credentials provider needs Prisma + bcrypt, which aren't
 * Edge-runtime compatible. Full config with providers lives in ./auth.ts
 * and only ever runs in a Node.js context.
 *
 * `cookies` uses an app-specific prefix ("k4udash") so this app's Auth.js
 * cookies never collide with apps/web's ("k4uweb") — both run on
 * `localhost` and browsers scope cookies by hostname only, not port. See
 * packages/auth/src/cookies.ts for the full rationale.
 */
export const authConfig: NextAuthConfig = {
  ...sharedAuthConfig,
  cookies: buildAuthCookies("k4udash"),
  providers: [],
  pages: { signIn: "/login" },
};
