/** Plain-language labels for SettlementStatus — same "never rely on color alone" convention as order-status-labels.ts. */
export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending (in hold period)",
  ON_HOLD: "On hold",
  ELIGIBLE: "Eligible for payout",
  PROCESSING: "Processing",
  SETTLED: "Settled",
  PARTIALLY_SETTLED: "Partially settled",
  REVERSED: "Reversed",
  FAILED: "Failed",
  NEEDS_REVIEW: "Needs review",
  // Not a real SettlementStatus DB value — a UI-only label for a commission-
  // table row whose order hasn't reached DELIVERED yet, so no
  // SellerSettlement row exists (see @kisan4u/orders' AWAITING_DELIVERY).
  AWAITING_DELIVERY: "Awaiting delivery",
};

export const SETTLEMENT_ADJUSTMENT_REASON_LABEL: Record<string, string> = {
  RETURN: "Return",
  REFUND: "Refund",
  CANCELLATION: "Cancellation",
  RTO: "Return to origin (RTO)",
  CHARGEBACK: "Chargeback",
  MANUAL_CORRECTION: "Manual correction",
};
