"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Client boundary so descendant Client Components (e.g. profile-form.tsx)
 * can call next-auth/react's useSession()/update() to refresh the session
 * cookie after an edit — without turning the root layout itself into a
 * Client Component. Server Components like SiteHeader don't need this;
 * they read the session directly via auth() on every request.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
