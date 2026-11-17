/**
 * Net-Payable-Amount pricing aid.
 *
 * The product form normally asks a seller for a selling price (directly, or
 * as MRP + discount). In "Net payable" mode it instead asks for the amount
 * the seller wants to be left with AFTER the settlement deductions that
 * apply when one unit of this product is delivered — seller commission and
 * its GST, the logistics slab charge and its GST, the collection charge
 * (higher of a flat floor or a % of value) and its GST, plus fixed TCS and
 * TDS. This module back-solves the selling price from that figure, and also
 * runs the forward direction (used for the "max net payable before the
 * price would exceed MRP" ceiling and the summary table).
 *
 * It is a PRICING AID, not the settlement authority. The real settlement
 * calculator (packages/orders/src/settlement-calculator.ts +
 * settlement-order-calculator.ts) still owns every rupee that actually gets
 * paid, and is untouched by this feature — the form/server only ever use
 * the result here to fill in the ordinary sellingPrice / discountValue that
 * gets stored, so catalogue, checkout and settlement never see anything new.
 * Two deliberate simplifications, both explained to the seller in the UI:
 *   1. It assumes this unit ships ALONE (qty 1). Real settlement bases the
 *      logistics slab on the whole seller order's combined weight and the
 *      collection charge on its combined value, then allocates back per
 *      line — so the actual netted amount moves once the unit ships
 *      alongside others.
 *   2. Every component is rounded to 2dp, so a handful of target values are
 *      not exactly reproducible; `deriveSellingPriceFromNetPayable` returns
 *      the closest achievable price and flags `exact: false`.
 *
 * The forward math here mirrors settlement-calculator.ts /
 * settlement-order-calculator.ts for a single line, qty 1, no coupon. A
 * drift test in packages/orders (which can import both) cross-checks it.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type CollectionChargeRule = {
  chargeType: "FLAT" | "PERCENTAGE";
  /** Flat amount (FLAT) or percent of seller-order value (PERCENTAGE). */
  value: number;
  minCharge: number | null;
  maxCharge: number | null;
};

export type NetPayableRateParams = {
  /** Seller's settlement commission rate for this audience — SellerProfile.commissionPercent (CUSTOMER) or dealerCommissionPercent (DEALER). */
  commissionPercent: number;
  commissionGstPercent: number;
  logisticsGstPercent: number;
  collectionChargeGstPercent: number;
  /** Fixed statutory rate — packages/orders FIXED_TCS_PERCENT (0.5). */
  tcsPercent: number;
  /** Fixed statutory rate — packages/orders FIXED_TDS_PERCENT (0.1). */
  tdsPercent: number;
  /** Active CollectionChargeConfig as plain numbers, or null → collection charge is 0 (same "missing config → 0" fallback as packages/orders/src/charges.ts). */
  collectionCharge: CollectionChargeRule | null;
};

export type NetPayableUnitParams = NetPayableRateParams & {
  /** Product.taxPercent. */
  gstRatePercent: number;
  taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
  /** Seller-borne logistics charge for this unit's shipment weight — matchShippingSlab(weight).price. 0 when weight/logistics config is unknown (the derived price is then a touch high; the form requires a weight in this mode). */
  logisticsCharge: number;
};

export type DerivedSellingPrice = {
  /** Back-solved selling price. 0 when the target is unreachable (too low / non-positive) — the caller should surface an error. */
  sellingPrice: number;
  /** What `sellingPrice` actually nets when run forward through this module — equals the target when `exact`. */
  netPayable: number;
  /** false when the target isn't exactly reproducible at 2dp; `sellingPrice` is then the closest achievable. */
  exact: boolean;
};

/** Collection charge for a given tax-inclusive seller-order value — mirrors calculateCollectionCharge in packages/orders/src/charges.ts. */
export function collectionChargeFor(
  sellerOrderValue: number,
  rule: CollectionChargeRule | null,
): number {
  if (!rule) return 0;
  let amount = rule.chargeType === "FLAT" ? rule.value : (sellerOrderValue * rule.value) / 100;
  if (rule.minCharge != null) amount = Math.max(amount, rule.minCharge);
  if (rule.maxCharge != null) amount = Math.min(amount, rule.maxCharge);
  return round2(amount);
}

function sellingPriceToTotalSales(sellingPrice: number, p: NetPayableUnitParams): number {
  return p.taxCalcMode === "INCLUDE_WITH_PRICE"
    ? sellingPrice
    : sellingPrice * (1 + p.gstRatePercent / 100);
}

function totalSalesToSellingPrice(totalSales: number, p: NetPayableUnitParams): number {
  return p.taxCalcMode === "INCLUDE_WITH_PRICE"
    ? totalSales
    : totalSales / (1 + p.gstRatePercent / 100);
}

/**
 * Forward direction: the net payable one delivered unit at `sellingPrice`
 * would leave the seller with, under this module's single-line assumption.
 * Mirrors calculateSettlement's payable chain (every component rounded to
 * 2dp before the final subtraction; a negative result is returned as-is,
 * never clamped — the caller decides what to do with it).
 */
export function settlementNetPayableForSellingPrice(
  sellingPrice: number,
  p: NetPayableUnitParams,
): number {
  const totalSales = round2(sellingPriceToTotalSales(sellingPrice, p));
  const rawTaxableValue = totalSales / (1 + p.gstRatePercent / 100);
  const logisticsCharge = Math.max(0, p.logisticsCharge || 0);

  const grossCommission = round2((totalSales * p.commissionPercent) / 100);
  const grossCommissionTax = round2((grossCommission * p.commissionGstPercent) / 100);
  const logisticTax = round2((logisticsCharge * p.logisticsGstPercent) / 100);
  const collectionCharge = collectionChargeFor(totalSales, p.collectionCharge);
  const collectionChargeTax = round2((collectionCharge * p.collectionChargeGstPercent) / 100);
  const tcs = round2((rawTaxableValue * p.tcsPercent) / 100);
  const tds = round2((totalSales * p.tdsPercent) / 100);

  return round2(
    totalSales -
      grossCommission -
      grossCommissionTax -
      logisticsCharge -
      logisticTax -
      collectionCharge -
      collectionChargeTax -
      tcs -
      tds,
  );
}

/**
 * Highest net-payable a seller may enter for this unit before the derived
 * selling price would exceed `mrp` — i.e. the net payable that a selling
 * price of exactly `mrp` produces. This is the "bar" the form shows under
 * each net-payable input.
 */
export function maxNetPayableForMrp(mrp: number, p: NetPayableUnitParams): number {
  return settlementNetPayableForSellingPrice(mrp, p);
}

/**
 * Inverse direction: the selling price whose delivered net payable is
 * `netPayable`. Seeds a closed-form solution for each collection-charge
 * regime (flat floor / proportional / max-clamped), then does a tiny
 * bounded search around each seed against the exact forward function and
 * keeps the price with the smallest forward error — this makes the result
 * robust to the 2dp rounding in the forward chain and to which side of a
 * collection-charge clamp the answer lands on, without any fragile
 * seam-condition branching.
 */
export function deriveSellingPriceFromNetPayable(
  netPayable: number,
  p: NetPayableUnitParams,
): DerivedSellingPrice {
  const g = p.gstRatePercent / 100;
  const c = p.commissionPercent / 100;
  const kc = p.commissionGstPercent / 100;
  const kl = p.logisticsGstPercent / 100;
  const kcc = p.collectionChargeGstPercent / 100;
  const tcs = p.tcsPercent / 100;
  const tds = p.tdsPercent / 100;
  const logisticsCharge = Math.max(0, p.logisticsCharge || 0);
  const logisticTerm = logisticsCharge * (1 + kl);

  // payable ≈ D·totalSales − logisticTerm − collectionCharge·(1 + kcc)
  const D = 1 - c * (1 + kc) - tcs / (1 + g) - tds;

  const rule = p.collectionCharge;
  const seedTotalSales: number[] = [];

  if (!rule || rule.chargeType === "FLAT") {
    // Collection charge is constant in totalSales.
    const cc = collectionChargeFor(0, rule);
    if (D > 1e-9) seedTotalSales.push((netPayable + logisticTerm + cc * (1 + kcc)) / D);
  } else {
    const pct = rule.value / 100;
    const min = rule.minCharge ?? 0;
    const max = rule.maxCharge ?? Number.POSITIVE_INFINITY;
    // Floor regime: collection charge pinned at `min`.
    if (D > 1e-9) seedTotalSales.push((netPayable + logisticTerm + min * (1 + kcc)) / D);
    // Proportional regime: collection charge = pct·totalSales.
    const bProp = D - pct * (1 + kcc);
    if (bProp > 1e-9) seedTotalSales.push((netPayable + logisticTerm) / bProp);
    // Ceiling regime: collection charge pinned at `max`.
    if (Number.isFinite(max) && D > 1e-9) {
      seedTotalSales.push((netPayable + logisticTerm + max * (1 + kcc)) / D);
    }
  }

  let best: DerivedSellingPrice | null = null;
  for (const totalSales of seedTotalSales) {
    if (!Number.isFinite(totalSales) || totalSales <= 0) continue;
    const seedPrice = round2(totalSalesToSellingPrice(totalSales, p));
    for (let step = -12; step <= 12; step++) {
      const candidate = round2(seedPrice + step * 0.01);
      if (candidate <= 0) continue;
      const net = settlementNetPayableForSellingPrice(candidate, p);
      const err = Math.abs(net - netPayable);
      if (
        best === null ||
        err < Math.abs(best.netPayable - netPayable) - 1e-9 ||
        (Math.abs(err - Math.abs(best.netPayable - netPayable)) <= 1e-9 &&
          candidate < best.sellingPrice)
      ) {
        best = { sellingPrice: candidate, netPayable: net, exact: err < 0.005 };
      }
    }
  }

  return best ?? { sellingPrice: 0, netPayable: 0, exact: false };
}
