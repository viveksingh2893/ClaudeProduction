import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { validateUserSession, hasPermission, type PermissionAction } from "@kisan4u/auth";

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
 * from either the same way: it navigates the client). Used inside
 * app/admin/actions.ts too, not just pages — a Server Action can be
 * invoked independent of which page rendered it, so the mutation itself
 * must re-check, not just trust that the page that rendered its trigger
 * button already checked.
 */
export async function requireSession(
  allowedRoles?: Array<"ADMIN" | "SELLER" | "STAFF">,
  options?: {
    /**
     * The /change-password page itself passes this — every other caller
     * omits it and gets the forced redirect below. Without this escape
     * hatch, a user who owes a password change could never reach the one
     * page that lets them clear it.
     */
    allowPasswordChangePending?: boolean;
  },
) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role as "ADMIN" | "SELLER" | "STAFF")) {
    redirect("/login");
  }

  const check = await validateUserSession(session.user.id, session.user.sessionVersion);
  if (!check.valid) {
    redirect("/api/session/revoke");
  }

  // Live DB check (never the JWT, which is only refreshed at sign-in) —
  // same "re-checked fresh on every protected request" convention as the
  // sessionVersion check just above. Set by an admin password reset
  // (packages/auth/src/password-reset.ts:adminResetPassword); cleared only
  // by a successful changeOwnPassword.
  if (check.mustChangePassword && !options?.allowPasswordChangePending) {
    redirect("/change-password");
  }

  return session;
}

/**
 * requireSession(["ADMIN", "STAFF"]) plus a live permission check —
 * ADMIN and STAFF converge onto the same Role/RolePermission table (see
 * packages/auth/src/permissions.ts), so a Super Admin (every permission
 * granted) sails through every check here exactly like today, while a
 * restricted STAFF role (e.g. Sales Agent) only reaches what its Role was
 * actually granted. Use this instead of a bare `requireSession(["ADMIN"])`
 * for any route a non-ADMIN role should ever be able to reach.
 */
export async function requireAdminPermission(
  module: string,
  action: PermissionAction = "VIEW",
  options?: { allowPasswordChangePending?: boolean },
) {
  const session = await requireSession(["ADMIN", "STAFF"], options);
  if (!(await hasPermission(session.user.id, module, action))) {
    redirect("/admin");
  }
  return session;
}

/**
 * Like requireAdminPermission, but a plain ADMIN session passes
 * unconditionally (no module check) — use this to OPEN an
 * existing ADMIN-only route to an additional STAFF role without
 * risking a regression for an admin who happens to lack that exact
 * grant. A STAFF account still needs the (module, action) permission.
 */
export async function requireAdminOrModule(
  module: string,
  action: PermissionAction = "VIEW",
  options?: { allowPasswordChangePending?: boolean },
) {
  const session = await requireSession(["ADMIN", "STAFF"], options);
  if (session.user.role === "ADMIN") return session;
  if (await hasPermission(session.user.id, module, action)) return session;
  redirect("/admin");
}
