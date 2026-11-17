import { signOut } from "@/auth";

/**
 * Landing point for a session that failed the revocation check in
 * requireSession(). A plain Server Component can't clear cookies (Next
 * only allows response-header mutation from Server Actions, Route
 * Handlers, and Middleware) — this Route Handler exists specifically to
 * clear the stale session cookie via signOut() before sending the user
 * on to /login, instead of leaving a dead cookie in the browser that
 * would just fail the same check again on every request.
 */
export async function GET() {
  return signOut({ redirectTo: "/login" });
}
