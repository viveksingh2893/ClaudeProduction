/**
 * THE single, order-aware settlement calculator (settlement-correction
 * task, "logistics and collection-charge allocation" revision). Replaces
 * the old per-item calculation (calculateItemLogisticsCharge +
 * calculateCollectionCharge called once per item — see git history for
 * settlement-logistics.ts) with a seller-order-level calculation:
 *
 *   - Logistics: ONE slab lookup against the seller order's COMBINED
 *     shipment weight (sum of every line's own unitWeight x fulfilledQty),
 *     never a separate slab per item and never a slice of the checkout-time
 *     combined-weight charge either — this is its own, settlement-specific
 *     combined-weight lookup.
 *   - Collection charge: ONE calculation (higher of the configured flat
 *     minimum or percentage) against the seller order's COMBINED net sales
 *     value, never evaluated independently per item.
 *
 * Both order-level totals are then allocated back across the seller
 * order's line items — logistics/its tax by each line's weight share,
 * collection charge/its tax by each line's net-value share — using
 * money.ts's allocateProportionally (decimal-safe, largest-remainder
 * method), which guarantees the line allocations sum EXACTLY to the
 * order-level total with no floating-point drift and no leftover paisa.
 * That satisfies the task's explicit requirement that
 * sum(lineAllocations) == sellerOrderTotal always, without needing a
 * separate "assign the remainder to the last line" step bolted on after —
 * largest-remainder already IS a deterministic, sum-exact rounding method
 * (same one this codebase already uses for multi-seller promotional-
 * discount allocation), just keyed by largest fractional remainder instead
 * of order-item id. Both are equally valid per the task's "such as" —
 * reusing the existing, already-tested primitive rather than inventing a
 * second deterministic-remainder algorithm.
 *
 * Deliberately still separate from settlement.ts (the ledger/DB service):
 * this file is pure aside from the two async lookups it makes
 * (calculateShippingCostForWeight, calculateCollectionCharge, both already
 * the codebase's single source of truth for those individual figures) — it
 * takes already-resolved item figures (price/tax/discount) as input rather
 * than reading OrderItem/SellerOrder rows itself, so it stays unit-testable
 * without a live seller order fixture (see settlement-order-calculator.test.ts).
 * settlement.ts remains the ONLY writer of SellerSettlement rows and the
 * ONLY caller of this function; every reader (table, export, API) still
 * only ever reads what settlement.ts persisted, never recalculates.
 */
import {
  calculateShippingCostForWeight,
  getActiveLogisticsConfig,
  toShippingConfigInput,
} from "@kisan4u/catalog";
import { calculateSettlement, type SettlementCalculationResult } from "./settlement-calculator";
import { calculateCollectionCharge } from "./charges";
import { round2, allocateProportionally } from "./money";

export type SellerOrderSettlementItemInput = {
  orderItemId: string;
  /** Order-time weight snapshot (unitWeightGrams x fulfilledQty) — OrderItem.totalWeightGrams, immutable once the order is placed, so a later product-weight edit never changes a historical settlement. */
  lineWeightGrams: number;
  /** Tax-inclusive, post-discount line total ("Total Sales") — this line's own net value, already computed independently of logistics/collection charge. */
  lineNetValue: number;
  taxRatePercent: number;
};

export type SellerOrderSettlementRates = {
  commissionValuePercent: number;
  commissionGstRatePercent: number;
  logisticsGstRatePercent: number;
  collectionChargeGstRatePercent: number;
  tcsRatePercent: number;
  tdsRatePercent: number;
};

export type SellerOrderSettlementLine = {
  orderItemId: string;
  lineWeightGrams: number;
  lineNetValue: number;
  logisticAllocation: number;
  logisticTaxAllocation: number;
  collectionAllocation: number;
  collectionTaxAllocation: number;
  calc: SettlementCalculationResult;
};

export type SellerOrderSettlementResult =
  | {
      ok: true;
      sellerOrderTotalWeightGrams: number;
      sellerOrderTotalNetValue: number;
      logisticsSlabSnapshot: Record<string, unknown>;
      sellerOrderLogisticsCharge: number;
      sellerOrderLogisticsTax: number;
      sellerOrderCollectionCharge: number;
      sellerOrderCollectionTax: number;
      lines: SellerOrderSettlementLine[];
    }
  | { ok: false; error: string };

/**
 * Every field on every item must be present and > 0 for the combined-weight
 * lookup to be meaningful — a single bad/missing weight makes the ENTIRE
 * seller order's logistics charge (and therefore every line's allocation)
 * unreliable, so this fails the whole calculation rather than silently
 * treating the bad item as 0g (which would understate the combined weight
 * and therefore undercharge every line, not just the bad one).
 */
function findInvalidWeightItem(
  items: SellerOrderSettlementItemInput[],
): SellerOrderSettlementItemInput | undefined {
  return items.find((i) => !Number.isFinite(i.lineWeightGrams) || i.lineWeightGrams <= 0);
}

export async function calculateSellerOrderSettlement(
  items: SellerOrderSettlementItemInput[],
  rates: SellerOrderSettlementRates,
): Promise<SellerOrderSettlementResult> {
  if (items.length === 0) return { ok: false, error: "Seller order has no items to settle." };

  // Deterministic processing order — order-item id, so a re-run against the
  // same data always produces the same per-line allocation, independent of
  // whatever order Prisma happened to return the items in.
  const sorted = [...items].sort((a, b) =>
    a.orderItemId < b.orderItemId ? -1 : a.orderItemId > b.orderItemId ? 1 : 0,
  );

  const invalidWeightItem = findInvalidWeightItem(sorted);
  if (invalidWeightItem) {
    return {
      ok: false,
      error: `Order item ${invalidWeightItem.orderItemId} has a missing or invalid weight (${invalidWeightItem.lineWeightGrams}g) — cannot calculate the seller-order's combined shipment weight.`,
    };
  }

  const sellerOrderTotalWeightGrams = sorted.reduce((sum, i) => sum + i.lineWeightGrams, 0);
  if (sellerOrderTotalWeightGrams <= 0) {
    return {
      ok: false,
      error: "Seller-order total shipment weight is zero — cannot match a logistics slab.",
    };
  }

  // ONE slab lookup for the combined weight — never per item, never a slice
  // of the item's own unit weight.
  const slabMatch = await calculateShippingCostForWeight(sellerOrderTotalWeightGrams);
  if (!slabMatch.ok) return { ok: false, error: slabMatch.error };
  const sellerOrderLogisticsCharge = round2(slabMatch.price);
  const sellerOrderLogisticsTax = round2(
    (sellerOrderLogisticsCharge * rates.logisticsGstRatePercent) / 100,
  );

  const activeConfig = await getActiveLogisticsConfig();
  const logisticsSlabSnapshot = buildSlabSnapshot(sellerOrderTotalWeightGrams, activeConfig);

  // ONE collection-charge calculation for the combined net value — never
  // per item.
  const sellerOrderTotalNetValue = round2(sorted.reduce((sum, i) => sum + i.lineNetValue, 0));
  const collectionCalc = await calculateCollectionCharge(sellerOrderTotalNetValue);
  const sellerOrderCollectionCharge = collectionCalc.finalCharge;
  const sellerOrderCollectionTax = round2(
    (sellerOrderCollectionCharge * rates.collectionChargeGstRatePercent) / 100,
  );

  const weightShares = sorted.map((i) => i.lineWeightGrams);
  // A zero combined net value (e.g. every line fully discounted to ₹0) makes
  // value-proportional allocation undefined — falls back to an equal split
  // across lines so the charge is still allocated deterministically rather
  // than silently landing entirely on one line or being dropped; the
  // reviewNote set by the caller (settlement.ts) tells the reader this
  // fallback was used.
  const netValueShares =
    sellerOrderTotalNetValue > 0 ? sorted.map((i) => i.lineNetValue) : sorted.map(() => 1);

  const logisticAllocations = allocateProportionally(sellerOrderLogisticsCharge, weightShares);
  const logisticTaxAllocations = allocateProportionally(sellerOrderLogisticsTax, weightShares);
  const collectionAllocations = allocateProportionally(sellerOrderCollectionCharge, netValueShares);
  const collectionTaxAllocations = allocateProportionally(sellerOrderCollectionTax, netValueShares);

  const lines: SellerOrderSettlementLine[] = sorted.map((item, idx) => {
    const calc = calculateSettlement({
      totalSales: item.lineNetValue,
      gstRatePercent: item.taxRatePercent,
      commissionValuePercent: rates.commissionValuePercent,
      commissionGstRatePercent: rates.commissionGstRatePercent,
      logistic: logisticAllocations[idx]!,
      logisticGstRatePercent: rates.logisticsGstRatePercent,
      logisticTaxOverride: logisticTaxAllocations[idx]!,
      collectionCharge: collectionAllocations[idx]!,
      collectionChargeGstRatePercent: rates.collectionChargeGstRatePercent,
      collectionChargeTaxOverride: collectionTaxAllocations[idx]!,
      tcsRatePercent: rates.tcsRatePercent,
      tdsRatePercent: rates.tdsRatePercent,
    });
    return {
      orderItemId: item.orderItemId,
      lineWeightGrams: item.lineWeightGrams,
      lineNetValue: item.lineNetValue,
      logisticAllocation: logisticAllocations[idx]!,
      logisticTaxAllocation: logisticTaxAllocations[idx]!,
      collectionAllocation: collectionAllocations[idx]!,
      collectionTaxAllocation: collectionTaxAllocations[idx]!,
      calc,
    };
  });

  return {
    ok: true,
    sellerOrderTotalWeightGrams,
    sellerOrderTotalNetValue,
    logisticsSlabSnapshot,
    sellerOrderLogisticsCharge,
    sellerOrderLogisticsTax,
    sellerOrderCollectionCharge,
    sellerOrderCollectionTax,
    lines,
  };
}

function buildSlabSnapshot(
  weightGrams: number,
  config: Awaited<ReturnType<typeof getActiveLogisticsConfig>>,
): Record<string, unknown> {
  const input = toShippingConfigInput(config);
  if (!config || !input) return { configId: null, aboveMax: false, price: null };
  if (weightGrams > input.maxWeightGrams) {
    return { configId: config.id, aboveMax: true, price: input.aboveMaxPrice };
  }
  const slab = input.slabs.find(
    (s) => weightGrams >= s.lowerWeightGrams && weightGrams <= s.upperWeightGrams,
  );
  return {
    configId: config.id,
    aboveMax: false,
    lowerWeightGrams: slab?.lowerWeightGrams ?? null,
    upperWeightGrams: slab?.upperWeightGrams ?? null,
    price: slab?.price ?? null,
  };
}
