import { round2 } from "@kisan4u/orders";

/**
 * Breaks the amount actually owed down into the components an admin asked
 * to see at a glance: the prepaid (online-charged) share, the
 * COD/deferred-at-delivery share, and any wallet contribution — rather than
 * a single opaque total.
 *
 * `allocation.amount` is this seller order's own share of the ORIGINAL
 * Payment.totalAmount, which per checkout.ts's `chargeAmount = isPartial ?
 * advancePlan.advanceAmount : grandTotal` is already exactly the prepaid
 * (online-charged) figure for ONLINE_PARTIAL/ONLINE_FULL/
 * TRANSPORT_FULL_ONLINE, and the full COD figure for a COD order. Both the
 * prepaid and COD shares are computed from `netPayable` (already net of
 * any promo discount — see checkout.ts's "grandTotal is already net of the
 * customer promo discount" comment) — subtracting `discountAmount` again
 * here would double-count it, so the discount is surfaced only as context,
 * never re-subtracted from the total (confirmed against how the POS
 * checkout panel itself derives "Amount to collect now" / "Remaining on
 * delivery (COD)" from the same already-discounted grandTotal).
 */
export function buildOrderAmountEquation(order: {
  paymentMethod: string;
  netPayable: number;
  discountAmount: number;
  customerType: string;
  allocation: { amount: unknown; walletAmountApplied: unknown } | null;
}): {
  prepaidAmount: number;
  codAmount: number;
  walletAmount: number;
  finalAmount: number;
  discountNote: number | null;
} {
  const prepaidCharged = order.allocation ? Number(order.allocation.amount) : 0;
  const walletAmount = order.allocation ? Number(order.allocation.walletAmountApplied) : 0;

  let prepaidAmount = 0;
  let codAmount = 0;
  if (order.paymentMethod === "COD") {
    // A COD order can be part- (or fully) paid from the buyer's wallet at
    // checkout — only what's left is collected in cash on delivery.
    codAmount = Math.max(0, round2(order.netPayable - walletAmount));
  } else if (order.paymentMethod === "ONLINE_PARTIAL") {
    prepaidAmount = prepaidCharged;
    codAmount = round2(order.netPayable - prepaidCharged);
  } else {
    // ONLINE_FULL / TRANSPORT_FULL_ONLINE / WALLET — fully prepaid, nothing
    // deferred to COD.
    prepaidAmount = order.netPayable;
  }

  return {
    prepaidAmount,
    codAmount,
    walletAmount,
    finalAmount: round2(order.netPayable - walletAmount),
    discountNote:
      order.customerType === "CUSTOMER" && order.discountAmount > 0 ? order.discountAmount : null,
  };
}

export type OrderAmountEquation = ReturnType<typeof buildOrderAmountEquation>;

/**
 * A POS "checkout group" can bundle several sellers' orders behind one
 * customer-facing payment (see listCheckoutGroupsForPlacedBy) — this sums
 * each seller order's own equation into one combined equation for the
 * group-level row, rather than inventing a separate group-level formula.
 */
export function sumOrderAmountEquations(equations: OrderAmountEquation[]): OrderAmountEquation {
  const totalDiscount = equations.reduce((sum, e) => sum + (e.discountNote ?? 0), 0);
  return {
    prepaidAmount: round2(equations.reduce((sum, e) => sum + e.prepaidAmount, 0)),
    codAmount: round2(equations.reduce((sum, e) => sum + e.codAmount, 0)),
    walletAmount: round2(equations.reduce((sum, e) => sum + e.walletAmount, 0)),
    finalAmount: round2(equations.reduce((sum, e) => sum + e.finalAmount, 0)),
    discountNote: totalDiscount > 0 ? round2(totalDiscount) : null,
  };
}
