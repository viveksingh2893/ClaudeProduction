/**
 * Pure partial-payment advance arithmetic — no dependency on Prisma/DB, so
 * it can be reused both as the server-authoritative calculation
 * (packages/orders/src/partial-payment.ts, which looks up the active
 * PartialPaymentConfig row and passes its ruleType/value here) and for an
 * instant client-side preview in the checkout form when the customer/dealer
 * switches payment method — the checkout page passes down the currently
 * active rule's plain {ruleType, value} once, and the form recomputes
 * locally without a server round-trip. Same "safe to import client-side"
 * convention as pricing.ts's calculateSellingPrice.
 */
export type PartialPaymentRuleTypeInput = "PERCENTAGE" | "FIXED_AMOUNT" | "MIN_ADVANCE_PERCENTAGE";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeAdvanceAmountPure(
  totalAmount: number,
  ruleType: PartialPaymentRuleTypeInput,
  value: number,
): { advanceAmount: number; remainingAmount: number } {
  let advance = ruleType === "FIXED_AMOUNT" ? value : round2((totalAmount * value) / 100);
  advance = Math.min(Math.max(advance, 0), totalAmount);
  return { advanceAmount: round2(advance), remainingAmount: round2(totalAmount - advance) };
}

/**
 * How a checkout total is split between the wallet, an online payment and
 * cash on delivery. The wallet is always applied LAST — every discount
 * (promo, prepaid/partial, coupon) is already inside `grandTotal`:
 *  - COD: wallet comes off the whole total; the rest is due on delivery.
 *  - PREPAID (full online): wallet comes off the whole total; the rest is
 *    paid online.
 *  - PARTIAL: `advanceAmount` is worked out on the FULL total by the caller
 *    and is never reduced by the wallet; the wallet only comes off the COD
 *    remainder (grandTotal − advance). Example: 1000 total, 200 advance
 *    online, 800 remainder — a 300 wallet leaves 500 due on delivery.
 * `walletBalance` and `walletRequested` are clamped, so callers can pass raw
 * values. Shared by packages/orders' checkout() (authoritative) and the
 * mobile checkout screen (display) so the two can't drift.
 */
export type WalletSplitKind = "COD" | "PARTIAL" | "PREPAID";

export function computeWalletSplit(input: {
  kind: WalletSplitKind;
  grandTotal: number;
  /** PARTIAL only — the advance, already computed on the full grandTotal. */
  advanceAmount?: number;
  walletBalance: number;
  walletRequested: number;
}): {
  /** Most the wallet can cover for this method. */
  walletEligibleCap: number;
  walletApplied: number;
  /** Paid online now (the advance for PARTIAL, the post-wallet total for PREPAID, 0 for COD). */
  onlineNow: number;
  /** Still due in cash on delivery after the wallet. */
  codDue: number;
} {
  const grandTotal = Math.max(0, input.grandTotal);
  const advance =
    input.kind === "PARTIAL" ? Math.min(Math.max(0, input.advanceAmount ?? 0), grandTotal) : 0;
  // What the wallet is allowed to come off: the COD remainder for a partial
  // order, the whole total otherwise.
  const base = input.kind === "PARTIAL" ? grandTotal - advance : grandTotal;
  const walletEligibleCap = round2(Math.max(0, Math.min(input.walletBalance, base)));
  const walletApplied = round2(Math.min(Math.max(0, input.walletRequested), walletEligibleCap));
  const left = round2(base - walletApplied);
  if (input.kind === "PARTIAL") {
    return { walletEligibleCap, walletApplied, onlineNow: round2(advance), codDue: left };
  }
  if (input.kind === "COD") {
    return { walletEligibleCap, walletApplied, onlineNow: 0, codDue: left };
  }
  return { walletEligibleCap, walletApplied, onlineNow: left, codDue: 0 };
}
