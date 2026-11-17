import type { BadgeTone } from "@kisan4u/ui";

/**
 * A POS-placed, non-COD order's OrderStatus stays PENDING_PAYMENT for the
 * entire proof-review cycle (see packages/orders/src/pos-payment-proof.ts) —
 * this derives the actually-useful display label from the payment proof's
 * own review state instead. A buyer paying in instalments has one live
 * submission per instalment ("slot" — see PosPaymentProofSubmission's doc
 * comment); callers pass only the LIVE ones (via
 * selectLivePaymentProofSubmissions from @kisan4u/orders), never the full
 * history. A rejected slot's re-upload creates a NEW row chained via
 * previousSubmissionId, which is exactly what makes the old REJECTED row
 * stop being "live" — so this never needs to know about superseded rows
 * itself. Shared by the general admin order list and the POS agent's own
 * "My orders" list so both use identical wording.
 *
 * Precedence when slots disagree: a REJECTED slot always needs the agent's
 * attention first (even if other slots are already APPROVED), then a
 * PENDING slot needs the reviewer's attention, and only once every live
 * slot is APPROVED is the whole thing "Approved".
 */
export function posPaymentProofStatusLabel(order: {
  /** True for a POS order (placedByUserId set); false for any self-service checkout, which never has a proof submission at all. */
  isPosOrder: boolean;
  paymentMethod: string;
  liveSubmissions: { status: string }[];
  /**
   * True when every live slot is individually APPROVED but their amounts
   * don't yet sum to the required remaining balance (e.g. 50 + 40
   * approved against a required 100) — still needs another screenshot,
   * so this must never read as "Approved".
   */
  amountShort?: boolean;
}): { label: string; tone: BadgeTone } {
  if (!order.isPosOrder || order.paymentMethod === "COD") return { label: "—", tone: "neutral" };
  if (order.liveSubmissions.length === 0) return { label: "Proof needed", tone: "warning" };
  if (order.liveSubmissions.some((s) => s.status === "REJECTED")) {
    return { label: "Proof rejected", tone: "danger" };
  }
  if (order.liveSubmissions.some((s) => s.status === "PENDING")) {
    return {
      label: order.liveSubmissions.length > 1 ? "Proofs uploaded" : "Proof uploaded",
      tone: "warning",
    };
  }
  if (order.amountShort) return { label: "Amount short", tone: "warning" };
  return { label: "Approved", tone: "success" };
}
