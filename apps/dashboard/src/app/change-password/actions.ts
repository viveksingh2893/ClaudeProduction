"use server";

import { changeOwnPassword } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The only way `User.mustChangePassword` is ever cleared. Requires an
 * authenticated ADMIN/SELLER session — `allowPasswordChangePending: true`
 * is what lets this run for an account still owing a password change
 * (every other Server Action in this app omits that flag and would
 * instead redirect such a session straight back here).
 */
export async function changePasswordAction(
  newPassword: string,
  confirmPassword: string,
): Promise<Result> {
  const session = await requireSession(["ADMIN", "SELLER", "STAFF"], {
    allowPasswordChangePending: true,
  });
  return changeOwnPassword(session.user.id, { newPassword, confirmPassword });
}
