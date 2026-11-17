/**
 * Seller settlement ledger — service layer.
 *
 * Column mapping / assumptions (documented here since several of the
 * required Excel headings are ambiguous on their own — see the final
 * report for the full rationale):
 *   - "Product Price"                  = per-unit price, excl. tax, before any item-level discount (OrderItem.unitPrice
 *     for an EXCLUDE_WITH_PRICE line; for an INCLUDE_WITH_PRICE line, OrderItem.unitPrice is the full tax-inclusive
 *     price instead, so this column is the taxable value derived from it — see OrderItem.taxCalcMode's schema doc
 *     comment and money.ts's resolveTaxBreakdown).
 *   - "Net Sales After All Deductions" = per-unit price AFTER this item's allocated share of order-level discounts/coupons.
 *     Currently always equals "Product Price", since OrderItem.discountAmount is always 0 today (checkout.ts) and
 *     CouponRedemption is the only source of a nonzero allocation.
 *   - "Fulfilled Qty"                  = OrderItem.quantity. The codebase has no partial-fulfillment/split-shipment
 *     model (a single quantity field, no partial-delivery status) — this is full-line fulfillment. A future partial
 *     return is modeled as a SettlementAdjustment against the money amount, not a reduction of this field, since no
 *     schema exists to track partial-quantity delivery/return.
 *   - "Product Price Inc(Tax)"         = the line's full tax-inclusive per-unit price — unitPrice itself for an
 *     INCLUDE_WITH_PRICE line (it already is tax-inclusive), or unitPrice x (1 + GST%) for EXCLUDE_WITH_PRICE.
 *     Display-only.
 *   - "Total Sales"                    = the authoritative gross, tax-inclusive, post-discount-allocation line amount.
 *     "Net Sales (Excl. Tax)" and "GST Tax" are DERIVED from Total Sales via the required division formula (not
 *     computed independently), which is what makes the two golden workbook examples reproduce exactly.
 *   - "Categories"                     = commissionType snapshot ("PERCENTAGE") — confirmed against the task
 *     description and the sample data, not a product category.
 *   - "Order ID"                       = SellerOrder.orderNumber (the seller-scoped order id a seller actually
 *     recognizes as "their" order, e.g. K4U-...-S1) — not CheckoutGroup.groupNumber, which spans multiple sellers.
 *   - "Order DateTime"                 = SellerOrder.createdAt (when the order was placed), distinct from the
 *     internal eligibleAt/deliveredAt timestamps used for settlement eligibility.
 *
 * Only SellerOrders that reach DELIVERED ever get settlement rows (the
 * codebase's Phase 4 return/refund/RTO statuses are unimplemented stubs in
 * status-transitions.ts — see reverseSettlement's doc comment for how a
 * later return/refund is meant to be wired in once those transitions
 * exist). A settlement never becomes SETTLED automatically — no real payout
 * workflow exists yet in this codebase, so SETTLED is always a manual,
 * server-authorized admin action (markSettlementsSettled). This function
 * only ever moves a row through PENDING -> ELIGIBLE -> (admin) SETTLED, or
 * flags it NEEDS_REVIEW.
 */
import {
  prisma,
  Prisma,
  getFullName,
  type OrderStatus,
  type PaymentStatus,
  type PaymentMethod,
  type UserRole,
  type SettlementStatus,
  type SettlementAdjustmentReason,
} from "@kisan4u/db";
import { calculateSettlement } from "./settlement-calculator";
import {
  calculateSellerOrderSettlement,
  type SellerOrderSettlementLine,
} from "./settlement-order-calculator";
import {
  resolveSettlementRates,
  resolveSettlementHoldDays,
  FIXED_TCS_PERCENT,
  FIXED_TDS_PERCENT,
} from "./settlement-rates";
import {
  cyclePayoutDateForEligibleDate,
  settlementCycleForEligibleDate,
  settlementCycleFromKey,
  type SettlementCycle,
} from "./settlement-cycle";
import { round2, allocateProportionally, resolveTaxBreakdown } from "./money";
import { writeAuditLog } from "./audit";
import { resolveBaCommissionRate } from "./ba/settings";
import { calculateBaCommissionForSellerOrder, BA_COMMISSION_GST_PERCENT } from "./ba/commission";
import { accrueOrderCommissionEarning, reverseOrderCommissionEarning } from "./ba/earnings";

type SettlementTxClient = Pick<
  typeof prisma,
  | "sellerOrder"
  | "sellerSettlement"
  | "settlementAdjustment"
  | "couponRedemption"
  | "product"
  | "baEarning"
>;

/**
 * OrderItem.taxRatePercent is a non-nullable column that checkout.ts has
 * always populated since the order model's inception — no known real data
 * lacks this snapshot today. This fallback exists purely as a documented
 * safety net (e.g. a future raw-SQL import, or a schema change that makes
 * the column nullable) — it is gated strictly on the value being
 * null/undefined, NEVER on the value being 0, because 0% is a legitimate
 * real GST rate that must never be silently overridden by a live product
 * lookup. Reads Product.taxPercent directly (single, audience-independent
 * rate — see its schema comment), not a per-audience config, so there's
 * no longer a customerType branch here.
 */
async function resolveTaxRatePercent(
  tx: SettlementTxClient,
  item: { taxRatePercent: Prisma.Decimal | null; productId: string },
): Promise<number> {
  if (item.taxRatePercent != null) return Number(item.taxRatePercent);
  const product = await tx.product.findUnique({
    where: { id: item.productId },
    select: { taxPercent: true },
  });
  return product ? Number(product.taxPercent) : 0;
}

// v2: corrected logistics (per-item weight-slab lookup, not a slice of the
// combined-weight checkout charge) and fixed TCS/TDS rates — see the
// settlement-correction task's formula reference.
// v3: collection charge corrected again — product-wise (higher of the
// configured minimum or % of THIS item's own total net value, evaluated
// independently per item) rather than v2's order-level-then-allocated
// approach, per explicit follow-up direction: a seller reading the ledger
// row by row found the order-level split confusing (fractional per-row
// amounts that don't match "30 or 1.5%" for that row on its own).
// v4: reversed back to order-level for BOTH logistics and collection
// charge, per the settlement order-level allocation task — grouping must
// happen at the seller-order level (one combined-weight slab lookup, one
// collection-charge calculation against the order's combined net value),
// then allocated proportionally across lines via
// settlement-order-calculator.ts's calculateSellerOrderSettlement, never
// independently recomputed per item. Unlike v3's order-level approach, v4's
// allocation is decimal-safe and guaranteed to reconcile exactly (see
// money.ts:allocateProportionally) — the "fractional per-row amounts"
// concern from the v3 changelog is a display/communication choice this
// task explicitly reopens; the export/table now surface the shared
// "Total Shipment Weight"/"Logistics Slab" figures alongside each line's
// allocation so the row is still self-explanatory.
// Existing v1/v2/v3 rows are left untouched unless they are recomputed
// (still in a RECOMPUTABLE_STATUSES state) via a retry or the backfill
// script — see RECOMPUTABLE_STATUSES below.
const SETTLEMENT_CALCULATION_VERSION = 4;

// Statuses a row can still be safely recomputed in (idempotent retry of the
// same delivery event). Once it leaves this set, only SettlementAdjustment
// rows may ever change its effective payable — the base row is immutable.
const RECOMPUTABLE_STATUSES: SettlementStatus[] = [
  "PENDING",
  "ON_HOLD",
  "ELIGIBLE",
  "NEEDS_REVIEW",
];

export type UpsertSettlementsResult =
  { ok: true; created: number; updated: number; skipped: number } | { ok: false; error: string };

/**
 * Idempotent: safe to call more than once for the same seller order (a
 * retried delivery event, or a backfill re-run) — creates or recomputes one
 * SellerSettlement row per OrderItem, keyed by the orderItemId unique
 * constraint, and never touches a row that has already moved past the
 * "still being calculated" statuses (see RECOMPUTABLE_STATUSES). No-ops
 * (not an error) if the seller order isn't actually DELIVERED, so it is
 * always safe to call defensively.
 */
export async function upsertSettlementsForSellerOrder(
  tx: SettlementTxClient,
  sellerOrderId: string,
): Promise<UpsertSettlementsResult> {
  const sellerOrder = await tx.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: {
      items: true,
      seller: {
        select: {
          id: true,
          shopName: true,
          commissionPercent: true,
          dealerCommissionPercent: true,
        },
      },
      customer: { select: { firstName: true, lastName: true, referredByBaId: true } },
      checkoutGroup: { include: { addressSnapshot: true } },
      charge: { select: { customerPayableTotal: true } },
      statusHistory: { where: { status: "DELIVERED" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!sellerOrder) return { ok: false, error: "Seller order not found." };
  if (sellerOrder.status !== "DELIVERED") return { ok: true, created: 0, updated: 0, skipped: 0 };
  if (sellerOrder.items.length === 0) return { ok: true, created: 0, updated: 0, skipped: 0 };
  // Imported already-closed-out from the legacy site (see
  // SellerOrder.legacyClosedOut's doc comment) — no real charge/logistics
  // record backs it, so it must never be settled, regardless of which
  // caller (the manual reconciliation CLI or a live delivery event) got
  // here. Enforced at this single chokepoint rather than at each call site.
  if (sellerOrder.legacyClosedOut) return { ok: true, created: 0, updated: 0, skipped: 0 };

  const [rates, holdDays, couponRedemptions] = await Promise.all([
    resolveSettlementRates(sellerOrder.sellerId, sellerOrder.customerType),
    resolveSettlementHoldDays(),
    tx.couponRedemption.findMany({ where: { sellerOrderId } }),
  ]);

  // Immutable delivery-event snapshot — the DELIVERED OrderStatusHistory row
  // is written in the same transaction this function is called from (see
  // order-workflow.ts:applyMockLogisticsEventForOrder), so it is always
  // present for a live delivery. Never falls back to updatedAt (which
  // drifts on unrelated edits) — null means "no trustworthy delivery
  // timestamp," surfaced as "Not recorded" rather than an invented date.
  const deliveredAt = sellerOrder.statusHistory[0]?.createdAt ?? null;
  const eligibleAt = new Date(
    (deliveredAt ?? sellerOrder.createdAt).getTime() + holdDays * 24 * 60 * 60 * 1000,
  );

  const weights = sellerOrder.items.map((item) => Number(item.subtotal));
  const totalCouponDiscount = couponRedemptions.reduce(
    (sum, c) => sum + Number(c.discountAmount),
    0,
  );
  const allocatedDiscounts = allocateProportionally(totalCouponDiscount, weights);

  // A settlement row only ever exists for a DELIVERED seller order (checked
  // above), and delivery is the point at which the balance is considered
  // collected — COD in full, an ONLINE_PARTIAL remainder on the doorstep
  // (autoCompletePaymentOnDelivery runs just before this for live orders).
  // Migrated legacy orders carry no Payment/PaymentAllocation rows at all,
  // so reading the allocation status would snapshot a misleading PENDING.
  // Business rule: delivered ⇒ paid, so the snapshot is always PAID.
  const financialStatusSnapshot: PaymentStatus = "PAID";
  const shippingStateSnapshot = sellerOrder.checkoutGroup.addressSnapshot?.state ?? "";
  const commissionValuePercent =
    sellerOrder.customerType === "DEALER"
      ? Number(sellerOrder.seller.dealerCommissionPercent)
      : Number(sellerOrder.seller.commissionPercent);

  // --- Per-item product/tax figures only (price, discount allocation,
  // GST). Logistics and collection charge are deliberately NOT computed
  // here anymore — both are seller-order-level calculations (combined
  // shipment weight -> one slab; combined net value -> one collection
  // charge), computed once below via calculateSellerOrderSettlement and
  // then allocated back across items, never independently re-derived per
  // item (see SETTLEMENT_CALCULATION_VERSION's v4 changelog above).
  const itemFigures = await Promise.all(
    sellerOrder.items.map(async (item, i) => {
      const unitPrice = Number(item.unitPrice);
      const qty = item.quantity;
      const itemSubtotal = Number(item.subtotal);
      const allocatedDiscount = allocatedDiscounts[i] ?? 0;
      const netSubtotalAfterDiscount = round2(itemSubtotal - allocatedDiscount);
      const unitPriceNetOfDeductions = qty > 0 ? round2(netSubtotalAfterDiscount / qty) : unitPrice;
      const taxRatePercent = await resolveTaxRatePercent(tx, item);
      const totalSales = round2(netSubtotalAfterDiscount * (1 + taxRatePercent / 100));
      // Was unconditionally `unitPrice * (1 + taxRatePercent/100)` — correct
      // only for a tax-EXCLUSIVE line (every pre-existing order; see
      // OrderItem.taxCalcMode's schema doc comment for why they default
      // there). For a tax-INCLUSIVE line, unitPrice already IS the
      // tax-inclusive price, so that formula double-counted the tax —
      // resolveTaxBreakdown's taxableValue+taxAmount always reconstructs
      // unitPrice exactly for INCLUDE_WITH_PRICE, and unitPrice*(1+rate/100)
      // for EXCLUDE_WITH_PRICE, so this one call is correct for both.
      const unitPriceIncTaxBreakdown = resolveTaxBreakdown(
        unitPrice,
        taxRatePercent,
        item.taxCalcMode,
      );
      const unitPriceIncTax = round2(
        unitPriceIncTaxBreakdown.taxableValue + unitPriceIncTaxBreakdown.taxAmount,
      );

      return { unitPrice, unitPriceNetOfDeductions, unitPriceIncTax, taxRatePercent, totalSales };
    }),
  );

  // ONE seller-order-level calculation for logistics + collection charge,
  // grouped by seller sub-order (never across sellers — sellerOrder.items
  // is already scoped to exactly one seller's items within this order by
  // construction), allocated back across every item above — see
  // settlement-order-calculator.ts. A failure here (missing/invalid
  // weight, zero combined weight, no matching slab) blocks
  // logistics/collection for EVERY line in this seller order — the loop
  // below still creates/updates each row (every other figure — price, GST,
  // commission, TCS, TDS — is independently computable), but with an
  // explicit ₹0 logistics/collection charge and a NEEDS_REVIEW status and
  // reviewNote, never a silent, unexplained ₹0.
  const orderCalc = await calculateSellerOrderSettlement(
    sellerOrder.items.map((item, i) => ({
      orderItemId: item.id,
      lineWeightGrams: item.totalWeightGrams,
      lineNetValue: itemFigures[i]!.totalSales,
      taxRatePercent: itemFigures[i]!.taxRatePercent,
    })),
    {
      commissionValuePercent,
      commissionGstRatePercent: rates.commissionGstPercent,
      logisticsGstRatePercent: rates.logisticsGstPercent,
      collectionChargeGstRatePercent: rates.collectionChargeGstPercent,
      tcsRatePercent: FIXED_TCS_PERCENT,
      tdsRatePercent: FIXED_TDS_PERCENT,
    },
  );
  const orderLevelError = orderCalc.ok ? null : orderCalc.error;
  const lineById = new Map<string, SellerOrderSettlementLine>(
    orderCalc.ok ? orderCalc.lines.map((l) => [l.orderItemId, l]) : [],
  );
  const zeroNetValueFallbackUsed = orderCalc.ok && orderCalc.sellerOrderTotalNetValue <= 0;

  // --- Business Associate commission (spec §4). Only when the buyer was
  // referred by a BA. Computed once for this seller order at THIS seller's
  // own configured rate, on the seller order's customer-payable total
  // (post-discount, pre-wallet), then allocated across its line items by
  // `totalSales` — the same allocation model as logistics / collection
  // charge. GST (18%) is seller-borne on top and is a tax remittance, not
  // BA income. Everything is snapshotted per row so a later BaRateConfig
  // edit never changes a past settlement. ---
  const baId = sellerOrder.customer.referredByBaId;
  let baCommissionByItem = new Map<string, { commission: number; gst: number }>();
  let sellerOrderBaCommission = 0;
  let sellerOrderBaCommissionGst = 0;
  let baCommissionGstRatePercent = 0;
  if (baId) {
    const rate = await resolveBaCommissionRate(sellerOrder.sellerId, sellerOrder.customerType);
    const commissionBase =
      Number(sellerOrder.charge?.customerPayableTotal ?? 0) ||
      round2(itemFigures.reduce((s, f) => s + f.totalSales, 0));
    const baCalc = calculateBaCommissionForSellerOrder(
      commissionBase,
      rate.commissionPercent,
      sellerOrder.items.map((it, i) => ({ lineId: it.id, lineValue: itemFigures[i]!.totalSales })),
    );
    sellerOrderBaCommission = baCalc.sellerOrderBaCommission;
    sellerOrderBaCommissionGst = baCalc.sellerOrderBaCommissionGst;
    baCommissionGstRatePercent = sellerOrderBaCommission > 0 ? BA_COMMISSION_GST_PERCENT : 0;
    baCommissionByItem = new Map(
      baCalc.lines.map((l) => [l.lineId, { commission: l.baCommission, gst: l.baCommissionGst }]),
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < sellerOrder.items.length; i++) {
    const item = sellerOrder.items[i]!;
    const figures = itemFigures[i]!;
    const existing = await tx.sellerSettlement.findUnique({
      where: { orderItemId: item.id },
      select: { id: true, status: true, deliveredAt: true },
    });
    if (existing && !RECOMPUTABLE_STATUSES.includes(existing.status)) {
      skipped++;
      continue;
    }

    // The seller-order-level allocation for this specific item — absent
    // only when orderCalc failed entirely (see orderLevelError below).
    const line = lineById.get(item.id);

    // Explicit ₹0, never an invented positive figure, when the seller-order
    // calculation failed — the NEEDS_REVIEW status + reviewNote below is
    // what actually surfaces this to an admin, not a silently-absent charge.
    const calc =
      line?.calc ??
      calculateSettlement({
        totalSales: figures.totalSales,
        gstRatePercent: figures.taxRatePercent,
        commissionValuePercent,
        commissionGstRatePercent: rates.commissionGstPercent,
        logistic: 0,
        logisticGstRatePercent: rates.logisticsGstPercent,
        collectionCharge: 0,
        collectionChargeGstRatePercent: rates.collectionChargeGstPercent,
        tcsRatePercent: FIXED_TCS_PERCENT,
        tdsRatePercent: FIXED_TDS_PERCENT,
      });

    const needsReview =
      calc.isNegativePayable || orderLevelError !== null || zeroNetValueFallbackUsed;
    const status: SettlementStatus = needsReview
      ? "NEEDS_REVIEW"
      : eligibleAt.getTime() <= Date.now()
        ? "ELIGIBLE"
        : "PENDING";

    const reviewNoteParts: string[] = [];
    // "No matching slab -> a clear configuration error, never a silent ₹0" —
    // surfaced here rather than blocking, since the order already exists by
    // settlement time and must stay visible (see §7 of the task spec). Now
    // a whole-seller-order concern (logistics/collection are calculated
    // once for the order, not per item), so the same note is attached to
    // every line in this seller order.
    if (orderLevelError) reviewNoteParts.push(`Logistics/collection charge: ${orderLevelError}`);
    if (zeroNetValueFallbackUsed) {
      reviewNoteParts.push(
        "Seller-order total net value is zero — collection charge was split evenly across items instead of by value share.",
      );
    }
    if (calc.isNegativePayable)
      reviewNoteParts.push("Negative payable — flagged for manual review, not clamped to zero.");

    const data = {
      currency: "INR",
      orderDateTime: sellerOrder.createdAt,
      financialStatusSnapshot,
      orderStatusSnapshot: sellerOrder.status,
      shippingStateSnapshot,
      productNameSnapshot: item.productName,
      shopNameSnapshot: sellerOrder.seller.shopName,
      customerNameSnapshot: getFullName(sellerOrder.customer) ?? "Customer",
      customerTypeSnapshot: sellerOrder.customerType,
      paymentMethodSnapshot: sellerOrder.paymentMethod,
      fulfilledQty: item.quantity,
      unitPrice: figures.unitPrice,
      unitPriceNetOfDeductions: figures.unitPriceNetOfDeductions,
      unitPriceIncTax: figures.unitPriceIncTax,
      totalSales: figures.totalSales,
      netSalesExclTax: calc.netSalesExclTax,
      gstRatePercent: figures.taxRatePercent,
      gstTax: calc.gstTax,
      commissionType: "PERCENTAGE" as const,
      commissionValuePercent,
      commissionBase: calc.commissionBase,
      grossCommission: calc.grossCommission,
      commissionGstRatePercent: rates.commissionGstPercent,
      grossCommissionTax: calc.grossCommissionTax,
      lineWeightGrams: item.totalWeightGrams,
      sellerOrderTotalWeightGrams: orderCalc.ok ? orderCalc.sellerOrderTotalWeightGrams : 0,
      logisticsSlabSnapshot: orderCalc.ok
        ? (orderCalc.logisticsSlabSnapshot as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      sellerOrderLogisticsCharge: orderCalc.ok ? orderCalc.sellerOrderLogisticsCharge : 0,
      sellerOrderLogisticsTax: orderCalc.ok ? orderCalc.sellerOrderLogisticsTax : 0,
      sellerOrderTotalNetValue: orderCalc.ok ? orderCalc.sellerOrderTotalNetValue : 0,
      sellerOrderCollectionCharge: orderCalc.ok ? orderCalc.sellerOrderCollectionCharge : 0,
      sellerOrderCollectionTax: orderCalc.ok ? orderCalc.sellerOrderCollectionTax : 0,
      logisticSellerBorne: line ? line.logisticAllocation : 0,
      logisticGstRatePercent: rates.logisticsGstPercent,
      logisticTax: calc.logisticTax,
      collectionCharge: line ? line.collectionAllocation : 0,
      collectionChargeGstRatePercent: rates.collectionChargeGstPercent,
      collectionChargeTax: calc.collectionChargeTax,
      tcsRatePercent: FIXED_TCS_PERCENT,
      tcsAmount: calc.tcs,
      tdsRatePercent: FIXED_TDS_PERCENT,
      tdsAmount: calc.tds,
      // BA commission (seller-borne) — this line's allocated share + 18% GST.
      baCommission: baCommissionByItem.get(item.id)?.commission ?? 0,
      baCommissionGstRatePercent,
      baCommissionGst: baCommissionByItem.get(item.id)?.gst ?? 0,
      sellerOrderBaCommission,
      sellerOrderBaCommissionGst,
      payableToSeller: round2(
        calc.payableToSeller -
          (baCommissionByItem.get(item.id)?.commission ?? 0) -
          (baCommissionByItem.get(item.id)?.gst ?? 0),
      ),
      calculationVersion: SETTLEMENT_CALCULATION_VERSION,
      status,
      eligibleAt,
      // Which 9th/19th/29th payout batch this row belongs to. Derived from
      // the same eligibleAt written just above, so it tracks a recompute
      // while the row is still RECOMPUTABLE and freezes with it once the
      // row is skipped (see the RECOMPUTABLE_STATUSES guard above).
      cyclePayoutDate: cyclePayoutDateForEligibleDate(eligibleAt),
      reviewNote: reviewNoteParts.length > 0 ? reviewNoteParts.join(" ") : null,
      // Never overwritten on a recompute of an already-existing row.
      deliveredAt: existing ? existing.deliveredAt : deliveredAt,
    };

    if (existing) {
      await tx.sellerSettlement.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await tx.sellerSettlement.create({
        data: {
          ...data,
          sellerId: sellerOrder.sellerId,
          checkoutGroupId: sellerOrder.checkoutGroupId,
          sellerOrderId: sellerOrder.id,
          orderItemId: item.id,
          productId: item.productId,
          variantId: item.variantId,
        },
      });
      created++;
    }
  }

  // One BA ORDER_COMMISSION earning per seller order (spec §4: "one row per
  // seller order"). Amount = the seller-order BA commission (the % only —
  // the 18% GST is a seller-borne tax, never BA income). Eligible on the
  // same delivery + return-window schedule as the seller settlement.
  if (baId && sellerOrderBaCommission > 0) {
    await accrueOrderCommissionEarning(tx, {
      baId,
      referredUserId: sellerOrder.customerId,
      sellerOrderId: sellerOrder.id,
      checkoutGroupId: sellerOrder.checkoutGroupId,
      sellerId: sellerOrder.sellerId,
      amount: sellerOrderBaCommission,
      ratePercent:
        sellerOrderBaCommission > 0 && Number(sellerOrder.charge?.customerPayableTotal ?? 0) > 0
          ? round2((sellerOrderBaCommission * 100) / Number(sellerOrder.charge!.customerPayableTotal))
          : 0,
      commissionBase: Number(sellerOrder.charge?.customerPayableTotal ?? 0),
      deliveredAt,
      eligibleAt,
    });
  }

  return { ok: true, created, updated, skipped };
}

/**
 * Backfills cyclePayoutDate on any pre-existing row that predates the
 * column (mostly a no-op after the settlement-cycles migration's own SQL
 * backfill — kept as a lazy safety net, same "no cron, reconcile on read"
 * convention as promoteEligibleSettlements). Bounded per call; drains over
 * a few reads if there is ever a large gap. Only touches rows still safe to
 * recompute — a finalized row's cycle is frozen.
 */
export async function backfillSettlementCycleDates(sellerId?: string, limit = 2000): Promise<number> {
  const rows = await prisma.sellerSettlement.findMany({
    where: {
      cyclePayoutDate: null,
      status: { in: RECOMPUTABLE_STATUSES },
      ...(sellerId ? { sellerId } : {}),
    },
    select: { id: true, eligibleAt: true, deliveredAt: true, createdAt: true },
    take: limit,
  });
  if (rows.length === 0) return 0;

  // Group ids by the computed payout instant so each distinct cycle is one
  // updateMany rather than one write per row.
  const byPayout = new Map<number, { date: Date; ids: string[] }>();
  for (const r of rows) {
    const eligible = r.eligibleAt ?? r.deliveredAt ?? r.createdAt;
    const payout = cyclePayoutDateForEligibleDate(eligible);
    const bucket = byPayout.get(payout.getTime());
    if (bucket) bucket.ids.push(r.id);
    else byPayout.set(payout.getTime(), { date: payout, ids: [r.id] });
  }
  for (const { date, ids } of byPayout.values()) {
    await prisma.sellerSettlement.updateMany({
      where: { id: { in: ids } },
      data: { cyclePayoutDate: date },
    });
  }
  return rows.length;
}

/** No cron/queue infrastructure exists in this codebase — eligibility is promoted lazily at the top of every settlement read (list/summary/export) rather than by a scheduled job. Safe to call repeatedly; only ever moves PENDING rows whose hold period has passed. Also tops up any missing cyclePayoutDate. */
export async function promoteEligibleSettlements(sellerId?: string): Promise<number> {
  const result = await prisma.sellerSettlement.updateMany({
    where: {
      status: "PENDING",
      eligibleAt: { lte: new Date() },
      ...(sellerId ? { sellerId } : {}),
    },
    data: { status: "ELIGIBLE" },
  });
  await backfillSettlementCycleDates(sellerId);
  return result.count;
}

export type ReverseSettlementInput = {
  settlementId: string;
  reason: SettlementAdjustmentReason;
  /** Signed amount to adjust the effective payable by. Omit for a full reversal (negates the current net payable exactly). */
  amount?: number;
  actor: { id: string; role: UserRole };
  note?: string;
  referenceType?: string;
  referenceId?: string;
};

/**
 * Never mutates or deletes the original SellerSettlement row — always
 * creates an append-only SettlementAdjustment. Exposed as a manual,
 * admin-authorized action. Not auto-wired to the RETURN, REFUND, or RTO
 * SellerOrder-status transitions, because those are unimplemented stubs in
 * status-transitions.ts today (empty rule arrays) — once that Phase-4-plus
 * work exists, the natural hook is to call this from wherever that
 * transition gets recorded, the same way upsertSettlementsForSellerOrder is
 * called from order-workflow.ts:markDelivered.
 */
export async function reverseSettlement(
  input: ReverseSettlementInput,
): Promise<{ ok: true; netPayable: number } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.sellerSettlement.findUnique({
      where: { id: input.settlementId },
      include: { adjustments: { select: { amount: true } } },
    });
    if (!settlement) return { ok: false, error: "Settlement not found." };
    if (settlement.status === "REVERSED") {
      return { ok: false, error: "This settlement has already been fully reversed." };
    }

    const priorAdjustmentTotal = settlement.adjustments.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );
    const currentNetPayable = round2(Number(settlement.payableToSeller) + priorAdjustmentTotal);
    const amount = input.amount ?? round2(-currentNetPayable);

    await tx.settlementAdjustment.create({
      data: {
        settlementId: input.settlementId,
        reason: input.reason,
        amount,
        note: input.note,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByRole: input.actor.role,
        createdById: input.actor.id,
      },
    });

    const netPayable = round2(currentNetPayable + amount);
    const nextStatus: SettlementStatus =
      netPayable <= 0
        ? "REVERSED"
        : settlement.status === "SETTLED"
          ? "PARTIALLY_SETTLED"
          : settlement.status;

    await tx.sellerSettlement.update({
      where: { id: input.settlementId },
      data: { status: nextStatus },
    });

    await writeAuditLog({
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: "SETTLEMENT_ADJUSTMENT",
      entityType: "SellerSettlement",
      entityId: input.settlementId,
      metadata: { reason: input.reason, amount, netPayable },
      reason: input.note,
    });

    return { ok: true, netPayable };
  });
}

/** SETTLED is always a manual admin action — no automatic payout integration exists in this codebase yet. Only ever promotes rows that are currently ELIGIBLE (never re-settles an already-settled or reversed row). */
export async function markSettlementsSettled(
  settlementIds: string[],
  actor: { id: string; role: UserRole },
): Promise<{ ok: true; count: number }> {
  if (settlementIds.length === 0) return { ok: true, count: 0 };
  const result = await prisma.sellerSettlement.updateMany({
    where: { id: { in: settlementIds }, status: "ELIGIBLE" },
    data: { status: "SETTLED", settledAt: new Date() },
  });
  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "SETTLEMENT_MARKED_SETTLED",
    entityType: "SellerSettlement",
    entityId: settlementIds.join(","),
    metadata: { count: result.count, settlementIds },
  });
  return { ok: true, count: result.count };
}

/**
 * A return was approved for a single order item — void that item's
 * settlement so it never pays out. Within the 48h return window the row is
 * still PENDING (never entered a payout cycle), so a full reversal drops
 * its net payable to 0 and flips it to REVERSED. If the row somehow got
 * past PENDING already (return approved after the window — shouldn't happen
 * once requestReturn enforces it, but handled defensively), the same
 * append-only reversal still applies and `pastWindow` is returned true so
 * the caller can flag it. A no-op when no settlement row exists yet (the
 * delivery→settlement upsert hasn't run) or it is already REVERSED.
 */
export async function voidSettlementForReturnedItem(
  orderItemId: string,
  actor: { id: string; role: UserRole },
  opts: { refundRequestId?: string; note?: string } = {},
): Promise<{ ok: true; voided: boolean; pastWindow: boolean }> {
  const row = await prisma.sellerSettlement.findUnique({
    where: { orderItemId },
    select: { id: true, status: true, sellerOrderId: true },
  });
  if (!row || row.status === "REVERSED") {
    return { ok: true, voided: false, pastWindow: false };
  }

  // Claw back the BA's ORDER_COMMISSION for this seller order (unless it has
  // already been paid out). v1 simplification: a return on any line reverses
  // the whole seller order's commission rather than reducing it pro-rata —
  // the return workflow itself is still minimal (see reverseSettlement's
  // doc comment).
  await reverseOrderCommissionEarning(
    prisma,
    row.sellerOrderId,
    "Order returned — BA commission reversed",
  ).catch(() => {});
  const pastWindow = !RECOMPUTABLE_STATUSES.includes(row.status);
  const result = await reverseSettlement({
    settlementId: row.id,
    reason: "RETURN",
    actor,
    note:
      opts.note ??
      (pastWindow
        ? "Return approved after the settlement left the pending window — voided via adjustment; review the payout batch."
        : "Return approved within the 48h window — settlement voided before payout."),
    referenceType: "RefundRequest",
    referenceId: opts.refundRequestId,
  });
  if (!result.ok) return { ok: true, voided: false, pastWindow };
  return { ok: true, voided: true, pastWindow };
}

/**
 * Marks every ELIGIBLE settlement row for one seller in one payout cycle
 * as SETTLED (the manual "we've paid this batch out" admin action). Rows
 * that are still PENDING, already SETTLED, or REVERSED are left untouched —
 * same guarantee as markSettlementsSettled, which this delegates to.
 *
 * A cycle can only be paid on or after its payout date (the 9th / 19th /
 * 29th). Before that it is refused here regardless of how the button was
 * rendered — the payout date is the real gate, not just eligibility.
 */
export async function markCycleSettledForSeller(
  payoutKey: string,
  sellerId: string,
  actor: { id: string; role: UserRole },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const cycle = settlementCycleFromKey(payoutKey);
  if (!cycle) return { ok: false, error: "Unknown settlement cycle." };
  if (Date.now() < cycle.payoutDate.getTime()) {
    return {
      ok: false,
      error: `This cycle can't be paid before its payout date (${cycle.payoutLabel}).`,
    };
  }
  const rows = await prisma.sellerSettlement.findMany({
    where: { cyclePayoutDate: cycle.payoutDate, sellerId, status: "ELIGIBLE" },
    select: { id: true },
  });
  if (rows.length === 0) return { ok: true, count: 0 };
  return markSettlementsSettled(
    rows.map((r) => r.id),
    actor,
  );
}

// ---------------------------------------------------------------------------
// Admin cross-seller settlement cycles view — one row per seller for a
// chosen 9th/19th/29th payout batch (see settlement-cycle.ts).
// ---------------------------------------------------------------------------

/** One-word rollup of a seller's slice of a payout cycle, for the list table's Status column. */
export type SettlementCycleRollupStatus =
  | "PAID" // every non-reversed row is SETTLED
  | "READY" // every non-reversed row is ELIGIBLE — can be marked paid now
  | "PARTIAL" // a mix of SETTLED and not-yet
  | "ACCRUING" // still has PENDING/ON_HOLD rows (48h hold not elapsed)
  | "REVIEW" // at least one NEEDS_REVIEW / FAILED row
  | "EMPTY"; // only REVERSED rows (nothing payable)

export type SettlementCycleSellerRow = {
  sellerId: string;
  shopName: string;
  orderCount: number;
  itemCount: number;
  grossSales: number;
  commission: number; // grossCommission + its GST
  logistics: number; // seller-borne logistics + its GST
  collectionCharge: number; // collection charge + its GST
  tcs: number;
  tds: number;
  adjustments: number; // signed sum of SettlementAdjustment amounts
  netPayable: number; // Σ payableToSeller + adjustments, excluding REVERSED rows
  statusCounts: Partial<Record<SettlementStatus, number>>;
  rollupStatus: SettlementCycleRollupStatus;
  /** true when every non-reversed row for this seller in this cycle is ELIGIBLE (ready to mark settled). */
  readyToSettle: boolean;
};

function rollupStatusFor(
  counts: Partial<Record<SettlementStatus, number>>,
): SettlementCycleRollupStatus {
  const n = (s: SettlementStatus) => counts[s] ?? 0;
  const nonReversed =
    Object.entries(counts).reduce((sum, [s, c]) => sum + (s === "REVERSED" ? 0 : (c ?? 0)), 0);
  if (nonReversed === 0) return "EMPTY";
  if (n("NEEDS_REVIEW") > 0 || n("FAILED") > 0) return "REVIEW";
  if (n("PENDING") > 0 || n("ON_HOLD") > 0 || n("PROCESSING") > 0) return "ACCRUING";
  const settled = n("SETTLED") + n("PARTIALLY_SETTLED");
  if (settled === nonReversed) return "PAID";
  if (settled > 0) return "PARTIAL";
  return "READY"; // all remaining are ELIGIBLE
}

export type SettlementCycleReport = {
  cycle: SettlementCycle;
  sellers: SettlementCycleSellerRow[];
  totals: {
    sellerCount: number;
    orderCount: number;
    itemCount: number;
    grossSales: number;
    commission: number;
    logistics: number;
    collectionCharge: number;
    tcs: number;
    tds: number;
    adjustments: number;
    netPayable: number;
  };
};

const PAYOUT_EXCLUDED_STATUSES: SettlementStatus[] = ["REVERSED"];

/**
 * All settlement rows whose frozen cyclePayoutDate matches the given
 * payout-date key (YYYY-MM-DD, IST), aggregated per seller. Promotes
 * eligibility + tops up any missing cyclePayoutDate first, same as every
 * other settlement read.
 */
export async function getSettlementCycleReport(
  payoutKey: string,
): Promise<SettlementCycleReport | null> {
  const cycle = settlementCycleFromKey(payoutKey);
  if (!cycle) return null;

  await promoteEligibleSettlements();

  const rows = await prisma.sellerSettlement.findMany({
    where: { cyclePayoutDate: cycle.payoutDate },
    select: {
      sellerId: true,
      shopNameSnapshot: true,
      sellerOrderId: true,
      status: true,
      totalSales: true,
      grossCommission: true,
      grossCommissionTax: true,
      logisticSellerBorne: true,
      logisticTax: true,
      collectionCharge: true,
      collectionChargeTax: true,
      tcsAmount: true,
      tdsAmount: true,
      payableToSeller: true,
      adjustments: { select: { amount: true } },
    },
  });

  // rollupStatus is derived once at the end (in the .map below), so the
  // running accumulator omits it.
  const bySeller = new Map<
    string,
    Omit<SettlementCycleSellerRow, "rollupStatus"> & {
      _orderIds: Set<string>;
      _nonReversed: number;
      _eligible: number;
    }
  >();

  for (const r of rows) {
    let s = bySeller.get(r.sellerId);
    if (!s) {
      s = {
        sellerId: r.sellerId,
        shopName: r.shopNameSnapshot,
        orderCount: 0,
        itemCount: 0,
        grossSales: 0,
        commission: 0,
        logistics: 0,
        collectionCharge: 0,
        tcs: 0,
        tds: 0,
        adjustments: 0,
        netPayable: 0,
        statusCounts: {},
        readyToSettle: false,
        _orderIds: new Set(),
        _nonReversed: 0,
        _eligible: 0,
      };
      bySeller.set(r.sellerId, s);
    }

    s._orderIds.add(r.sellerOrderId);
    s.itemCount += 1;
    s.statusCounts[r.status] = (s.statusCounts[r.status] ?? 0) + 1;

    const adj = r.adjustments.reduce((sum, a) => sum + Number(a.amount), 0);
    s.adjustments = round2(s.adjustments + adj);

    if (!PAYOUT_EXCLUDED_STATUSES.includes(r.status)) {
      s.grossSales = round2(s.grossSales + Number(r.totalSales));
      s.commission = round2(
        s.commission + Number(r.grossCommission) + Number(r.grossCommissionTax),
      );
      s.logistics = round2(s.logistics + Number(r.logisticSellerBorne) + Number(r.logisticTax));
      s.collectionCharge = round2(
        s.collectionCharge + Number(r.collectionCharge) + Number(r.collectionChargeTax),
      );
      s.tcs = round2(s.tcs + Number(r.tcsAmount));
      s.tds = round2(s.tds + Number(r.tdsAmount));
      s.netPayable = round2(s.netPayable + Number(r.payableToSeller) + adj);
      s._nonReversed += 1;
      if (r.status === "ELIGIBLE") s._eligible += 1;
    }
  }

  const sellers: SettlementCycleSellerRow[] = [...bySeller.values()]
    .map((s): SettlementCycleSellerRow => ({
      sellerId: s.sellerId,
      shopName: s.shopName,
      orderCount: s._orderIds.size,
      itemCount: s.itemCount,
      grossSales: s.grossSales,
      commission: s.commission,
      logistics: s.logistics,
      collectionCharge: s.collectionCharge,
      tcs: s.tcs,
      tds: s.tds,
      adjustments: s.adjustments,
      netPayable: s.netPayable,
      statusCounts: s.statusCounts,
      rollupStatus: rollupStatusFor(s.statusCounts),
      readyToSettle: s._nonReversed > 0 && s._eligible === s._nonReversed,
    }))
    .sort((a, b) => b.netPayable - a.netPayable);

  const totals = sellers.reduce(
    (t, s) => ({
      sellerCount: t.sellerCount + 1,
      orderCount: t.orderCount + s.orderCount,
      itemCount: t.itemCount + s.itemCount,
      grossSales: round2(t.grossSales + s.grossSales),
      commission: round2(t.commission + s.commission),
      logistics: round2(t.logistics + s.logistics),
      collectionCharge: round2(t.collectionCharge + s.collectionCharge),
      tcs: round2(t.tcs + s.tcs),
      tds: round2(t.tds + s.tds),
      adjustments: round2(t.adjustments + s.adjustments),
      netPayable: round2(t.netPayable + s.netPayable),
    }),
    {
      sellerCount: 0,
      orderCount: 0,
      itemCount: 0,
      grossSales: 0,
      commission: 0,
      logistics: 0,
      collectionCharge: 0,
      tcs: 0,
      tds: 0,
      adjustments: 0,
      netPayable: 0,
    },
  );

  return { cycle, sellers, totals };
}

/**
 * The list of cycles for the admin filter dropdown — every payout batch
 * that actually has settlement rows, newest first, plus the upcoming few
 * so an admin can see what's accruing. Each entry carries its own window
 * label.
 */
export async function listSettlementCyclesForFilter(): Promise<
  Array<SettlementCycle & { itemCount: number }>
> {
  await backfillSettlementCycleDates();
  const grouped = await prisma.sellerSettlement.groupBy({
    by: ["cyclePayoutDate"],
    where: { cyclePayoutDate: { not: null } },
    _count: { _all: true },
  });

  const merged = new Map<string, SettlementCycle & { itemCount: number }>();

  // Cycles that already have settlement rows.
  for (const g of grouped) {
    if (!g.cyclePayoutDate) continue;
    // cyclePayoutDate is 00:00 IST on the payout day; step ~10 days back
    // into its own feeding window to recover the cycle deterministically.
    const cycle = settlementCycleForEligibleDate(
      new Date(g.cyclePayoutDate.getTime() - 10 * 24 * 60 * 60 * 1000),
    );
    const existing = merged.get(cycle.key);
    merged.set(cycle.key, { ...cycle, itemCount: (existing?.itemCount ?? 0) + g._count._all });
  }

  // Plus the cycle currently accruing and the next couple, so an admin can
  // watch a batch fill up before its payout date.
  let probe = new Date();
  for (let i = 0; i < 3; i++) {
    const cycle = settlementCycleForEligibleDate(probe);
    if (!merged.has(cycle.key)) merged.set(cycle.key, { ...cycle, itemCount: 0 });
    probe = new Date(cycle.windowEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return [...merged.values()].sort((a, b) => b.payoutDate.getTime() - a.payoutDate.getTime());
}

export type SettlementFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  orderStatus?: OrderStatus;
  financialStatus?: PaymentStatus;
  transactionStatus?: SettlementStatus;
  paymentMethod?: PaymentMethod;
  customerType?: UserRole;
  /** Restrict to one payout cycle — a YYYY-MM-DD key from settlement-cycle.ts (the 9th/19th/29th, IST). Used by the admin per-seller-per-cycle drill-down page and its Excel export. */
  cyclePayoutKey?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

type SettlementSortKey = "orderDateTime" | "totalSales" | "payableToSeller" | "status";
const SETTLEMENT_SORT: Record<
  SettlementSortKey,
  (dir: "asc" | "desc") => Prisma.SellerSettlementOrderByWithRelationInput
> = {
  orderDateTime: (dir) => ({ orderDateTime: dir }),
  totalSales: (dir) => ({ totalSales: dir }),
  payableToSeller: (dir) => ({ payableToSeller: dir }),
  status: (dir) => ({ status: dir }),
};

function buildSettlementWhere(
  sellerId: string,
  filters: SettlementFilters,
): Prisma.SellerSettlementWhereInput {
  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const cyclePayoutDate = filters.cyclePayoutKey
    ? (settlementCycleFromKey(filters.cyclePayoutKey)?.payoutDate ?? null)
    : null;

  return {
    // sellerId is always supplied by the caller from a trusted server-side
    // source (the seller's own session, or the admin route's [id] param) —
    // never from client-controlled filter input. This is the actual seller
    // data isolation boundary; every other field below is a plain filter.
    sellerId,
    // A YYYY-MM-DD that doesn't resolve to a real cycle deliberately
    // matches nothing rather than silently ignoring the filter.
    ...(filters.cyclePayoutKey ? { cyclePayoutDate } : {}),
    // Always true today by construction (a SellerSettlement row only ever
    // exists for a DELIVERED order — see upsertSettlementsForSellerOrder),
    // but made an explicit server-side clause here so every consumer of
    // this where-builder (list, summary, and — most importantly — the
    // Excel/CSV export) enforces "delivered orders only" as a real
    // guarantee rather than an implicit invariant, per the task's
    // requirement that this rule be applied on the server/export query, not
    // only the UI.
    orderStatusSnapshot: "DELIVERED",
    ...(filters.orderStatus ? { orderStatusSnapshot: filters.orderStatus } : {}),
    ...(filters.financialStatus ? { financialStatusSnapshot: filters.financialStatus } : {}),
    ...(filters.transactionStatus ? { status: filters.transactionStatus } : {}),
    ...(filters.paymentMethod ? { paymentMethodSnapshot: filters.paymentMethod } : {}),
    ...(filters.customerType ? { customerTypeSnapshot: filters.customerType } : {}),
    ...(dateFilter ? { orderDateTime: dateFilter } : {}),
    ...(filters.search
      ? {
          OR: [
            {
              sellerOrder: {
                orderNumber: { contains: filters.search, mode: "insensitive" as const },
              },
            },
            {
              checkoutGroup: {
                groupNumber: { contains: filters.search, mode: "insensitive" as const },
              },
            },
            { productNameSnapshot: { contains: filters.search, mode: "insensitive" as const } },
            { customerNameSnapshot: { contains: filters.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

const SETTLEMENT_LIST_INCLUDE = {
  sellerOrder: { select: { orderNumber: true } },
  checkoutGroup: { select: { groupNumber: true } },
  adjustments: { orderBy: { createdAt: "asc" as const } },
} as const;

/**
 * Used by both the seller Settlement page (sellerId from the seller's own
 * session) and the admin seller-detail page (sellerId from the route's
 * [id] param) — identical scoping logic either way, so there is one
 * function rather than two that could silently drift apart.
 */
export async function listSettlements(sellerId: string, filters: SettlementFilters = {}) {
  await promoteEligibleSettlements(sellerId);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const sortField =
    filters.sortKey && filters.sortKey in SETTLEMENT_SORT
      ? SETTLEMENT_SORT[filters.sortKey as SettlementSortKey](sortDir)
      : { orderDateTime: sortDir };
  const where = buildSettlementWhere(sellerId, filters);

  const [rows, total] = await Promise.all([
    prisma.sellerSettlement.findMany({
      where,
      include: SETTLEMENT_LIST_INCLUDE,
      orderBy: sortField,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerSettlement.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

/**
 * Batched, cursor-paginated read of every settlement matching the active
 * filters (not just the current UI page) — used by the Excel export so it
 * never holds an unbounded array of rows in memory at once, regardless of
 * how many the filters match. Yields ~500 rows at a time.
 */
export async function* iterateAllSettlements(
  sellerId: string,
  filters: SettlementFilters = {},
  batchSize = 500,
) {
  await promoteEligibleSettlements(sellerId);
  const where = buildSettlementWhere(sellerId, {
    ...filters,
    page: undefined,
    pageSize: undefined,
  });
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.sellerSettlement.findMany({
      where,
      include: SETTLEMENT_LIST_INCLUDE,
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < batchSize) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

/** Ownership-scoped: returns null (never the row) if the settlement doesn't belong to this seller. */
export async function getSettlement(sellerId: string, settlementId: string) {
  return prisma.sellerSettlement.findFirst({
    where: { id: settlementId, sellerId },
    include: SETTLEMENT_LIST_INCLUDE,
  });
}

export type SettlementSummary = {
  totalSales: number;
  totalDeductions: number;
  totalPayable: number;
  settledAmount: number;
  pendingEligibleAmount: number;
  reversedAdjustedAmount: number;
  count: number;
};

export async function getSettlementSummary(
  sellerId: string,
  filters: SettlementFilters = {},
): Promise<SettlementSummary> {
  await promoteEligibleSettlements(sellerId);
  const where = buildSettlementWhere(sellerId, {
    ...filters,
    page: undefined,
    pageSize: undefined,
  });
  const rows = await prisma.sellerSettlement.findMany({
    where,
    select: {
      totalSales: true,
      grossCommission: true,
      grossCommissionTax: true,
      logisticSellerBorne: true,
      logisticTax: true,
      collectionCharge: true,
      collectionChargeTax: true,
      tcsAmount: true,
      tdsAmount: true,
      payableToSeller: true,
      status: true,
      adjustments: { select: { amount: true } },
    },
  });

  const summary: SettlementSummary = {
    totalSales: 0,
    totalDeductions: 0,
    totalPayable: 0,
    settledAmount: 0,
    pendingEligibleAmount: 0,
    reversedAdjustedAmount: 0,
    count: rows.length,
  };

  for (const r of rows) {
    const adjustmentSum = r.adjustments.reduce((sum, a) => sum + Number(a.amount), 0);
    const netPayable = round2(Number(r.payableToSeller) + adjustmentSum);
    const deductions = round2(
      Number(r.grossCommission) +
        Number(r.grossCommissionTax) +
        Number(r.logisticSellerBorne) +
        Number(r.logisticTax) +
        Number(r.collectionCharge) +
        Number(r.collectionChargeTax) +
        Number(r.tcsAmount) +
        Number(r.tdsAmount),
    );
    summary.totalSales = round2(summary.totalSales + Number(r.totalSales));
    summary.totalDeductions = round2(summary.totalDeductions + deductions);
    summary.totalPayable = round2(summary.totalPayable + netPayable);
    if (r.status === "SETTLED") summary.settledAmount = round2(summary.settledAmount + netPayable);
    else if (["PENDING", "ON_HOLD", "ELIGIBLE", "NEEDS_REVIEW", "PROCESSING"].includes(r.status)) {
      summary.pendingEligibleAmount = round2(summary.pendingEligibleAmount + netPayable);
    }
    if (adjustmentSum !== 0)
      summary.reversedAdjustedAmount = round2(summary.reversedAdjustedAmount + adjustmentSum);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Commission table — item-level view (root-cause fix for "orders visible on
// /seller/orders that never appear in the commission table"). listSettlements
// above is, by design, DELIVERED-only (a SellerSettlement row only ever
// exists once an order is DELIVERED — see upsertSettlementsForSellerOrder's
// doc comment) — that's correct for the export and the settle/reverse admin
// actions, which must only ever act on a real calculated settlement. But it
// means a PENDING/PACKED/IN_TRANSIT/CANCELLED/etc. order — fully visible on
// the seller's own order page — has NO row there at all, not a wrong one.
// listCommissionTableRows below queries OrderItem (scoped by the owning
// seller order's sellerId) instead, LEFT-joining the optional `settlement`
// relation, so every legitimate order item a seller owns shows up here with
// its live order status, with or without a settlement row yet.
// ---------------------------------------------------------------------------

/** A settlement-less item's virtual status — never persisted, never a DB enum value, purely a UI/filter label meaning "this item hasn't reached DELIVERED yet, so it has no settlement row." */
export const AWAITING_DELIVERY = "AWAITING_DELIVERY" as const;

export type CommissionFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Live SellerOrder.status — the full OrderStatus enum, matching /seller/orders (not the DELIVERED-only snapshot listSettlements filters on). */
  orderStatus?: OrderStatus;
  financialStatus?: PaymentStatus;
  transactionStatus?: SettlementStatus | typeof AWAITING_DELIVERY;
  paymentMethod?: PaymentMethod;
  customerType?: UserRole;
  /** Restrict to one payout cycle (YYYY-MM-DD key). Implies the item has a settlement row — an AWAITING_DELIVERY transactionStatus is incompatible and yields nothing. */
  cyclePayoutKey?: string;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

function buildCommissionWhere(
  sellerId: string,
  filters: CommissionFilters,
): Prisma.OrderItemWhereInput {
  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const cyclePayoutDate = filters.cyclePayoutKey
    ? (settlementCycleFromKey(filters.cyclePayoutKey)?.payoutDate ?? null)
    : null;

  // The optional `settlement` relation filter — merges a payout-cycle
  // restriction with a settlement-status one. A cycle filter implies the
  // item HAS a settlement, so it wins over an AWAITING_DELIVERY (no-row)
  // request rather than contradicting it.
  let settlementFilter: Prisma.OrderItemWhereInput["settlement"];
  if (filters.cyclePayoutKey) {
    const statusPart =
      filters.transactionStatus && filters.transactionStatus !== AWAITING_DELIVERY
        ? { status: filters.transactionStatus }
        : {};
    settlementFilter = { cyclePayoutDate, ...statusPart };
  } else if (filters.transactionStatus === AWAITING_DELIVERY) {
    settlementFilter = null;
  } else if (filters.transactionStatus) {
    settlementFilter = { status: filters.transactionStatus };
  }

  return {
    sellerOrder: {
      // The real seller data-isolation boundary here — always supplied by
      // the caller from a trusted server-side source, same convention as
      // buildSettlementWhere above.
      sellerId,
      ...(filters.orderStatus ? { status: filters.orderStatus } : {}),
      ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
      ...(filters.customerType ? { customerType: filters.customerType } : {}),
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(filters.financialStatus
        ? { paymentAllocations: { some: { payment: { status: filters.financialStatus } } } }
        : {}),
    },
    ...(settlementFilter !== undefined ? { settlement: settlementFilter } : {}),
    // A single OR across both item-level (productName) and order-level
    // (orderNumber/groupNumber/customerName) fields — deliberately NOT
    // nested inside the `sellerOrder` filter above, since Prisma would then
    // AND it against every other sellerOrder condition instead of OR-ing
    // across all four search targets.
    ...(filters.search
      ? {
          OR: [
            { productName: { contains: filters.search, mode: "insensitive" as const } },
            {
              sellerOrder: {
                orderNumber: { contains: filters.search, mode: "insensitive" as const },
              },
            },
            {
              sellerOrder: {
                checkoutGroup: {
                  groupNumber: { contains: filters.search, mode: "insensitive" as const },
                },
              },
            },
            {
              sellerOrder: {
                customer: {
                  firstName: { contains: filters.search, mode: "insensitive" as const },
                },
              },
            },
            {
              sellerOrder: {
                customer: {
                  lastName: { contains: filters.search, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {}),
  };
}

const COMMISSION_TABLE_INCLUDE = {
  sellerOrder: {
    select: {
      orderNumber: true,
      status: true,
      createdAt: true,
      paymentMethod: true,
      customerType: true,
      seller: { select: { shopName: true } },
      customer: { select: { firstName: true, lastName: true } },
      checkoutGroup: {
        select: { groupNumber: true, addressSnapshot: { select: { state: true } } },
      },
      paymentAllocations: { select: { payment: { select: { status: true } } }, take: 1 },
    },
  },
  settlement: { include: { adjustments: { orderBy: { createdAt: "asc" as const } } } },
} as const;

/**
 * The seller/admin commission-table data source. One row per OrderItem the
 * seller owns, regardless of delivery status — this is what makes a
 * still-PENDING order visible in the commission table with its live status,
 * fixing the "missing orders" gap (see the section doc comment above).
 * Financial columns come straight from the row's `settlement` when one
 * exists; when it doesn't (order not yet DELIVERED), every settlement-only
 * figure is null — the caller (settlement-view.ts) renders a provisional
 * total sales figure straight from the item's own already-stored
 * subtotal+taxAmount, never a newly invented formula.
 */
export async function listCommissionTableRows(sellerId: string, filters: CommissionFilters = {}) {
  await promoteEligibleSettlements(sellerId);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const where = buildCommissionWhere(sellerId, filters);

  const [rows, total] = await Promise.all([
    prisma.orderItem.findMany({
      where,
      include: COMMISSION_TABLE_INCLUDE,
      orderBy: { sellerOrder: { createdAt: sortDir } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.orderItem.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}
