import { requireSession } from "@/lib/session-guard";
import { ChangePasswordForm } from "./change-password-form";

/**
 * Landed on automatically — requireSession() redirects EVERY other
 * protected page here (see apps/dashboard/src/lib/session-guard.ts) while
 * User.mustChangePassword is true, whether that's because an admin just
 * issued a temporary password (see admin/sellers/[id]) or, later, any
 * other flow that sets the same flag. Not linked from the nav — there is
 * nothing else reachable until this is completed.
 */
export default async function ChangePasswordPage() {
  await requireSession(["ADMIN", "SELLER", "STAFF"], { allowPasswordChangePending: true });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-dashboard px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-surface p-7 sm:p-9">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-green-700">
          <span className="h-5 w-5 rounded-md border-[3px] border-white" />
        </div>
        <h1 className="text-xl font-extrabold text-green-800">Set a new password</h1>
        <p className="mt-1 text-sm text-gray-600">
          Your password was reset by an admin. Choose a new password to continue — it must be different from the one you just used to sign in.
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
