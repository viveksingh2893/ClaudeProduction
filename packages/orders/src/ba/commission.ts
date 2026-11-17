/**
 * BA order-commission math — pure, no I/O, unit-tested in commission.test.ts.
 *
 * The rule (spec answers #4, #15, #16, #17):
 *   - The commission base is the GRAND TOTAL the customer actually pays,
 *     after coupons + payment-method / deal discounts, EXCLUDING wallet —
 *     i.e. each seller order's `OrderCharge.customerPayableTotal`.
 *   - It is computed PER SELLER ORDER first, using THAT seller's own BA rate
 *     (different sellers in one cart can pay different %), then allocated
 *     across that seller order's line items proportionally by line value —
 *     the same allocation model logistics / collection charge already use.
 *   - GST on the BA commission is a flat 18%, borne by the seller (it is a
 *     tax remittance, never BA income), on top of the commission itself.
 *   - Only the fulfilled amount matters — callers pass fulfilled line values.
 *
 * Worked example from the spec: cart of ₹600 — Seller A has two lines
 * (₹100 + ₹200 = ₹300), Seller B one line (₹300); both sellers on the
 * default 2%. Seller A commission = ₹6, split ₹2 / ₹4 across its lines.
 * Seller B commission = ₹6 on its single line. BA earns ₹12 total; Sellers
 * A and B are additionally charged 18% GST (₹1.08 each) on their share.
 */

import { round2, allocateProportionally } from "../money";

/** Flat GST rate applied to every BA commission. Not admin-configurable. */
export const BA_COMMISSION_GST_PERCENT = 18;

export type BaCommissionLineInput = {
  /** Opaque id echoed back on the matching output line (usually the OrderItem id). */
  lineId: string;
  /**
   * This line's fulfilled value used as the allocation weight — the same
   * `totalSales` figure the seller settlement allocates logistics /
   * collection charge by.
   */
  lineValue: number;
};

export type BaCommissionLineResult = {
  lineId: string;
  /** This line's allocated share of the seller-order BA commission. */
  baCommission: number;
  /** This line's allocated share of the 18% GST on that commission. */
  baCommissionGst: number;
};

export type BaCommissionResult = {
  /** ratePercent x commissionBase, 2dp — what the BA earns for this seller order. */
  sellerOrderBaCommission: number;
  /** 18% of sellerOrderBaCommission, 2dp — extra seller-borne tax, not BA income. */
  sellerOrderBaCommissionGst: number;
  gstRatePercent: number;
  /** Per-line allocation; sums back to the seller-order totals above (paise-exact). */
  lines: BaCommissionLineResult[];
};

/**
 * @param commissionBase  the seller order's customer-payable total (post-discount, pre-wallet)
 * @param ratePercent     the resolved BA rate for (seller, customerType)
 * @param lines           this seller order's fulfilled line items + their values
 */
export function calculateBaCommissionForSellerOrder(
  commissionBase: number,
  ratePercent: number,
  lines: BaCommissionLineInput[],
): BaCommissionResult {
  const safeBase = Number.isFinite(commissionBase) && commissionBase > 0 ? commissionBase : 0;
  const safeRate = Number.isFinite(ratePercent) && ratePercent > 0 ? ratePercent : 0;

  const sellerOrderBaCommission = round2((safeBase * safeRate) / 100);
  const sellerOrderBaCommissionGst = round2(
    (sellerOrderBaCommission * BA_COMMISSION_GST_PERCENT) / 100,
  );

  const weights = lines.map((l) => (Number.isFinite(l.lineValue) && l.lineValue > 0 ? l.lineValue : 0));
  const commissionShares = allocateProportionally(sellerOrderBaCommission, weights);
  const gstShares = allocateProportionally(sellerOrderBaCommissionGst, weights);

  return {
    sellerOrderBaCommission,
    sellerOrderBaCommissionGst,
    gstRatePercent: BA_COMMISSION_GST_PERCENT,
    lines: lines.map((l, i) => ({
      lineId: l.lineId,
      baCommission: commissionShares[i] ?? 0,
      baCommissionGst: gstShares[i] ?? 0,
    })),
  };
}
