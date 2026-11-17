"use server";

import { markCycleSettledForSeller } from "@kisan4u/orders";
import { requireSettlementsEdit } from "@/lib/settlements-guard";

type Result = { ok: true; count: number } | { ok: false; error: string };

/**
 * Server-authorized, auditable — marks every ELIGIBLE settlement row for
 * one seller in one payout cycle as SETTLED. Reachable by ADMIN and by any
 * STAFF role granted settlements:EDIT (the "Payment Verifier" role). No
 * real payout integration exists yet, so this is the manual "we've paid
 * this batch out" action (delegates to
 * @kisan4u/orders:markCycleSettledForSeller, which itself only touches
 * ELIGIBLE rows, refuses before the payout date, and writes an audit log
 * carrying the acting user's real id and role).
 */
export async function markCycleSettledForSellerAction(
  payoutKey: string,
  sellerId: string,
): Promise<Result> {
  const session = await requireSettlementsEdit();
  return markCycleSettledForSeller(payoutKey, sellerId, {
    id: session.user.id,
    role: session.user.role,
  });
}
