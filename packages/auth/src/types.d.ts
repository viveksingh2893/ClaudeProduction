import type { UserRole } from "@kisan4u/db";

// Type-only augmentation — erased at compile time, never bundled, so
// this is safe to reference from edge-context files too.
declare module "next-auth" {
  interface User {
    role: UserRole;
    // Legacy-migration fix: User.name was split into firstName/lastName
    // (both nullable — see the split_user_name_and_legacy_fields
    // migration). Carried raw through the session rather than
    // pre-joined, so every consumer calls getFullName() from @kisan4u/db
    // and picks its own fallback (phone, "—", etc.) when both are absent.
    firstName: string | null;
    lastName: string | null;
    // Phase 2 fix: snapshot of User.sessionVersion at sign-in time, used
    // to detect server-side revocation on every subsequent request — see
    // packages/auth/src/access.ts:validateUserSession.
    sessionVersion: number;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      firstName: string | null;
      lastName: string | null;
      sessionVersion: number;
    } & DefaultSessionUser;
  }
}

// `next-auth/jwt` is a pure `export * from "@auth/core/jwt"` re-export
// with no local declarations of its own, so module augmentation must
// target the actual declaring module for the merge to take effect.
declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    role: UserRole;
    firstName: string | null;
    lastName: string | null;
    sessionVersion: number;
  }
}

// Minimal shape of next-auth's DefaultSession["user"] without importing
// the runtime module here.
interface DefaultSessionUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}
