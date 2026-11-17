import { requireAdminOrModule } from "./session-guard";

/**
 * Module key gating the "Settlement cycles" section (/admin/settlements/*)
 * — the slim per-cycle payout table, each seller's per-cycle breakdown,
 * the "Mark paid" action and the per-seller Excel export. ADMIN passes
 * unconditionally (via the seeded Super Admin role); a STAFF account needs
 * this module granted on its Role — the "Payment Verifier" role carries
 * it so a payment verifier can run the payout batches end to end.
 */
export const SETTLEMENTS_MODULE_KEY = "settlements";

/** Read gate — call from every settlements page AND the export route. */
export async function requireSettlementsView() {
  return requireAdminOrModule(SETTLEMENTS_MODULE_KEY, "VIEW");
}

/** Write gate — call from every settlements server action ("Mark paid"). */
export async function requireSettlementsEdit() {
  return requireAdminOrModule(SETTLEMENTS_MODULE_KEY, "EDIT");
}
