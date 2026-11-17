/// <reference path="./types.d.ts" />
// Triple-slash reference (not a regular import!): pulls the ambient
// module augmentations in types.d.ts into whichever TypeScript program
// reaches this file (packages/auth's own build, and every app that
// imports either this file directly or the main @kisan4u/auth barrel).
// Ambient .d.ts files are otherwise only picked up by a program that
// lists them in its own tsconfig "include", which apps consuming this
// as workspace source don't do. A plain `import "./types"` doesn't work
// here — Next's bundler tries to resolve it as a real runtime module and
// fails, since a .d.ts file emits nothing; a triple-slash reference is
// compiler-only and invisible to bundlers.
import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe pieces of the Auth.js config — NO providers here, and no
 * imports of anything Node-only (Prisma, bcrypt). This file is imported
 * by each app's `auth.config.ts`, which in turn is what `middleware.ts`
 * uses, and Next.js middleware runs on the Edge runtime by default.
 *
 * The actual Credentials providers (which DO need Prisma/bcrypt) live in
 * ./providers/* and are only ever imported by each app's full `auth.ts`
 * (a Node-context route handler), never by middleware. See
 * PHASE_0_SETUP.md-style notes in each app's auth.config.ts for why this
 * split exists.
 */
export const sharedAuthConfig: Omit<NextAuthConfig, "providers"> = {
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.role = user.role;
        token.uid = user.id;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        // Snapshot at sign-in only — this does NOT get refreshed on
        // later requests (there's no `trigger: "update"` call for it
        // anywhere), which is exactly what makes it useful: it's
        // compared against the live DB value on every protected request
        // to detect server-side revocation. See packages/auth/src/access.ts.
        token.sessionVersion = user.sessionVersion;
      }
      // Explicit opt-in refresh path, e.g. after a profile-name edit:
      // client calls next-auth/react's `update({ firstName, lastName })`,
      // which re-runs this callback with trigger="update" instead of a
      // fresh `user`. Nothing else (role/sessionVersion) is refreshable
      // this way on purpose — those must only ever come from a real
      // sign-in or the live DB check in access.ts, never from
      // client-supplied data.
      if (trigger === "update") {
        if (typeof session?.firstName === "string" || session?.firstName === null) {
          token.firstName = session.firstName;
        }
        if (typeof session?.lastName === "string" || session?.lastName === null) {
          token.lastName = session.lastName;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid;
        session.user.role = token.role;
        session.user.firstName = token.firstName;
        session.user.lastName = token.lastName;
        session.user.sessionVersion = token.sessionVersion;
      }
      return session;
    },
  },
};
