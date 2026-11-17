import { requireAdminPermission } from "./session-guard";

/**
 * The module key gating the "Payment Verifier" role — see
 * packages/auth/src/permissions.ts. ADMIN (via the seeded Super Admin
 * role, which is granted every KNOWN_MODULES permission) and a STAFF
 * account holding the "Payment Verifier" role both go through the same
 * check here.
 */
export const PAYMENT_VERIFICATION_MODULE_KEY = "payment-verification";

/** Server-side gate for the restricted payment-verification section — call from every page AND every server action in it, never rely on the page having already checked. */
export async function requirePaymentVerificationAccess() {
  return requireAdminPermission(PAYMENT_VERIFICATION_MODULE_KEY, "VIEW");
}
