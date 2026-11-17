import { requireAdminPermission } from "./session-guard";

/**
 * The module key gating the whole POS feature — see
 * packages/auth/src/permissions.ts. ADMIN (via the seeded Super Admin
 * role) and STAFF (e.g. a Sales Agent role) both go through the same
 * check here.
 */
export const POS_MODULE_KEY = "pos";

/** Server-side POS access gate — call from every POS page AND every POS server action, never rely on the page having already checked. */
export async function requirePosAccess() {
  return requireAdminPermission(POS_MODULE_KEY, "VIEW");
}
