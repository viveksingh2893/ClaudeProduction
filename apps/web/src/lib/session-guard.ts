import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { validateUserSession } from "@kisan4u/auth";

/**
 * The single server-side gate every protected page/action in this app
 * should go through. Two checks, both against live DB state, not just
 * the JWT payload:
 *   1. Is there a session at all (and, if `allowedRoles` given, the
 *      right role)?
 *   2. Has an admin revoked it since it was issued (sessionVersion
 *      mismatch) or deactivated the account (isActive)?
 *
 * On failure, redirects rather than throwing — safe to call from Server
 * Components and Server Actions alike (Next.js handles a thrown redirect
 * from either the same way: it navigates the client).
 */
export async function requireSession(
  allowedRoles?: Array<"CUSTOMER" | "DEALER">,
  options?: { next?: string },
) {
  const session = await auth();
  if (!session?.user) {
    redirect(options?.next ? `/login/mobile?next=${encodeURIComponent(options.next)}` : "/login");
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role as "CUSTOMER" | "DEALER")) {
    redirect(options?.next ? `/login/mobile?next=${encodeURIComponent(options.next)}` : "/login");
  }

  const check = await validateUserSession(session.user.id, session.user.sessionVersion);
  if (!check.valid) {
    if (check.reason === "deletion_pending") redirect("/account/delete");
    redirect("/api/session/revoke");
  }

  return session;
}
