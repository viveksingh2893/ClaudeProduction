import type { PaymentMethod } from "@kisan4u/db";
import type { PosCheckoutPreview } from "../actions";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The one formula for how a POS order's total is split — used identically by
 * the checkout panel's display AND by the workspace's Place Order call.
 * Keeping it in one place (rather than recomputed separately in two
 * components) is what guarantees the amount shown and the amount actually
 * submitted at Place Order can never drift apart.
 *
 * The wallet comes off the WHOLE order first, whichever payment method is
 * selected (COD included); COD / partial prepaid / full prepaid then work on
 * what is left — checkout() in packages/orders plans it the same way:
 *   - COD: everything left is collected on delivery.
 *   - Full prepaid: everything left is paid now (screenshot proof).
 *   - Partial prepaid: `posAdvanceAmountInput` (the operator-typed amount to
 *     collect now) is entered against what is left, the rest is COD.
 *
 * `posAdvanceAmountInput` is plain local UI state clamped to
 * [0, payableAfterWallet], not something read off `preview`.
 */
export function computePosPayableAmounts(
  preview: PosCheckoutPreview | null,
  paymentMethod: PaymentMethod | "",
  walletAmountInput: number,
  posAdvanceAmountInput: number,
): {
  walletEligibleCap: number;
  walletApplied: number;
  /** Order total minus the wallet share — what COD / partial / full prepaid then divide up. */
  payableAfterWallet: number;
  /** The part still to be paid now, outside the wallet (needs a payment-proof screenshot). 0 for COD. */
  remainingPayableNow: number;
  /** The part collected in cash on delivery: everything left for COD, the balance after the advance for a partial order, 0 for full prepaid. */
  codDue: number;
} {
  const grandTotal = preview?.draft.ok ? preview.draft.grandTotal : 0;
  const isPartial = paymentMethod === "ONLINE_PARTIAL";
  const walletBalance = preview?.wallet.balance ?? 0;
  const walletEligibleCap = Math.max(0, Math.min(walletBalance, grandTotal));
  const walletApplied = round2(Math.min(Math.max(0, walletAmountInput), walletEligibleCap));
  const payableAfterWallet = round2(grandTotal - walletApplied);
  const remainingPayableNow =
    paymentMethod === "COD" || !paymentMethod
      ? 0
      : isPartial
        ? round2(Math.max(0, Math.min(posAdvanceAmountInput, payableAfterWallet)))
        : payableAfterWallet;
  const codDue =
    paymentMethod === "COD"
      ? payableAfterWallet
      : isPartial
        ? round2(payableAfterWallet - remainingPayableNow)
        : 0;
  return { walletEligibleCap, walletApplied, payableAfterWallet, remainingPayableNow, codDue };
}
