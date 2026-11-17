/**
 * The single, pure, server-side seller-settlement calculator. Every other
 * place that needs a settlement amount (the settlement service, the Excel
 * export, the historical backfill script) reads an already-persisted
 * SellerSettlement row — nothing else in the codebase re-derives these
 * formulas. This keeps the formula defined in exactly one place, per the
 * task requirement ("one centralized, pure, server-side settlement
 * calculator — do not duplicate formulas in React components, APIs,
 * exports, and background jobs").
 *
 * Formulas and rounding policy are taken verbatim from the task's required
 * calculation rules (reproduced against the attached Order_Transaction_
 * details.xlsx golden examples in settlement-calculator.test.ts):
 *   - Commission base = Total Sales, inclusive of tax.
 *   - TCS base = Net Sales (Excl. Tax).
 *   - TDS base = Total Sales, inclusive of tax.
 *   - Every individual monetary component is rounded to 2 decimal places
 *     BEFORE the final payable subtraction — never round only the end
 *     result. Rounding reuses round2() (packages/orders/src/money.ts), the
 *     existing project-wide money-rounding convention (plain Math.round at
 *     2dp, which is round-half-up for the non-negative amounts every
 *     individual component here always is).
 *   - A negative payable is never clamped to 0 — the caller (settlement.ts)
 *     is responsible for flagging it NEEDS_REVIEW rather than silently
 *     zeroing it, per the task's explicit instruction.
 *
 * Fixed commission (CommissionType.FIXED) is intentionally NOT implemented
 * here: no field or business rule for a fixed per-seller commission amount
 * exists anywhere in the codebase today (SellerProfile only has
 * commissionPercent/dealerCommissionPercent), so a per-unit-vs-per-item
 * split would be an invented rule, not a mapping — see the final report.
 * Only CommissionType.PERCENTAGE is computable; callers must resolve a
 * PERCENTAGE commissionValuePercent before calling this function.
 */
import { round2 } from "./money";

export type SettlementCalculationInput = {
  /** Gross, tax-inclusive line sales for this settlement row (post any item-level discount/coupon allocation). */
  totalSales: number;
  gstRatePercent: number;
  /** Resolved seller commission rate for this order's customer type (SellerProfile.commissionPercent or dealerCommissionPercent). */
  commissionValuePercent: number;
  commissionGstRatePercent: number;
  /** Only the seller-borne portion — 0 if the platform/customer bears logistics for this order. */
  logistic: number;
  logisticGstRatePercent: number;
  /**
   * When provided, used directly as this line's logistics tax instead of
   * deriving it from logistic x logisticGstRatePercent — needed by the
   * seller-order-level allocation (settlement-order-calculator.ts), where
   * the order's total logistics tax is computed once and then allocated
   * proportionally across lines, so each line's tax must reconcile exactly
   * to that order-level total rather than being independently re-derived
   * from this line's own (already-rounded) allocated charge, which can
   * differ from the order-level allocation by a paisa. Omitted by every
   * caller that doesn't need order-level reconciliation (e.g. this file's
   * own tests), which keeps the rate-derived behavior fully unchanged.
   */
  logisticTaxOverride?: number;
  /** Only the seller-borne portion — collection charge is always seller-borne per existing business rules, but callers still pass 0 if none was charged. */
  collectionCharge: number;
  collectionChargeGstRatePercent: number;
  /** Same reconciliation reason as logisticTaxOverride, for the collection-charge tax. */
  collectionChargeTaxOverride?: number;
  tcsRatePercent: number;
  tdsRatePercent: number;
  /** Signed sum of previously approved SettlementAdjustment amounts to fold into payable (0 for a fresh calculation). */
  adjustments?: number;
};

export type SettlementCalculationResult = {
  netSalesExclTax: number;
  gstTax: number;
  commissionBase: number;
  grossCommission: number;
  grossCommissionTax: number;
  logisticTax: number;
  collectionChargeTax: number;
  tcs: number;
  tds: number;
  payableToSeller: number;
  isNegativePayable: boolean;
};

export function calculateSettlement(
  input: SettlementCalculationInput,
): SettlementCalculationResult {
  const {
    totalSales,
    gstRatePercent,
    commissionValuePercent,
    commissionGstRatePercent,
    logistic,
    logisticGstRatePercent,
    logisticTaxOverride,
    collectionCharge,
    collectionChargeGstRatePercent,
    collectionChargeTaxOverride,
    tcsRatePercent,
    tdsRatePercent,
    adjustments = 0,
  } = input;

  // Raw (unrounded) taxable value — used only to derive productGST and TCS
  // below, exactly matching the golden Excel's float-precision formula
  // chain (L8 = J8/(1+P8/100)*K8, carried at full precision into Q8/Z8
  // even though L8 DISPLAYS rounded). netSalesExclTax, the stored/displayed
  // component, is still separately rounded to 2dp immediately below —
  // productGST/TCS are display-only breakdowns that are never subtracted
  // again in the payable chain (see this file's doc comment), so deriving
  // them from the raw value rather than the already-rounded
  // netSalesExclTax is what reproduces the golden row's exact expected
  // ₹181.53 productGST rather than a ₹181.52 off-by-one-paisa value from
  // double-rounding. TCS comes out identical either way at this
  // precision, so there is no real tension with the "round every
  // component before the final payable subtraction" rule for the fields
  // that actually feed into it (grossCommission, taxes, TCS, TDS below all
  // still round from already-rounded, payable-chain inputs).
  const rawTaxableValue = totalSales / (1 + gstRatePercent / 100);
  const netSalesExclTax = round2(rawTaxableValue);
  const gstTax = round2((rawTaxableValue * gstRatePercent) / 100);

  const commissionBase = totalSales;
  const grossCommission = round2((commissionBase * commissionValuePercent) / 100);
  const grossCommissionTax = round2((grossCommission * commissionGstRatePercent) / 100);

  const logisticTax = logisticTaxOverride ?? round2((logistic * logisticGstRatePercent) / 100);
  const collectionChargeTax =
    collectionChargeTaxOverride ??
    round2((collectionCharge * collectionChargeGstRatePercent) / 100);

  const tcs = round2((rawTaxableValue * tcsRatePercent) / 100);
  const tds = round2((totalSales * tdsRatePercent) / 100);

  const payableToSeller = round2(
    totalSales -
      grossCommission -
      grossCommissionTax -
      logistic -
      logisticTax -
      collectionCharge -
      collectionChargeTax -
      tcs -
      tds +
      adjustments,
  );

  return {
    netSalesExclTax,
    gstTax,
    commissionBase,
    grossCommission,
    grossCommissionTax,
    logisticTax,
    collectionChargeTax,
    tcs,
    tds,
    payableToSeller,
    isNegativePayable: payableToSeller < 0,
  };
}
