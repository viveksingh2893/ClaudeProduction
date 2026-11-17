import { requireAdminPermission } from "./session-guard";

/**
 * The module key gating the Coupons section — see
 * packages/auth/src/permissions.ts. Only the seeded Super Admin role (via
 * KNOWN_MODULES in packages/db/prisma/seed.ts) is granted this by
 * default; no STAFF role gets coupon access unless separately granted.
 */
export const COUPONS_MODULE_KEY = "coupons";

/** Server-side gate for the coupons section — call from every page AND every server action in it, never rely on the page having already checked. */
export async function requireCouponsAccess() {
  return requireAdminPermission(COUPONS_MODULE_KEY, "VIEW");
}
