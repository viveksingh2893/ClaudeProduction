import {
  round2,
  AWAITING_DELIVERY,
  type listCommissionTableRows,
  type SettlementSummary,
} from "@kisan4u/orders";
import { getFullName } from "@kisan4u/db";

type RawCommissionRow = Awaited<ReturnType<typeof listCommissionTableRows>>["rows"][number];

/**
 * Decimal fields aren't plain-serializable across the Server -> Client
 * boundary (same convention as admin/sellers/page.tsx) — this trims a raw
 * item-level commission-table row (OrderItem + live sellerOrder + optional
 * settlement, from listCommissionTableRows) down to exactly what the shared
 * SettlementsTable renders, as plain numbers/strings.
 *
 * `id` is always the OrderItem id (never the settlement id) — a row exists
 * here whether or not a SellerSettlement row does yet, which is the whole
 * point of this view (see settlement.ts's "Commission table" doc comment
 * for why /seller/orders and this table must show the same set of items).
 * `settlementId` is null until the order is DELIVERED and a settlement row
 * exists; the UI uses that to hide settle/reverse actions and render "—"
 * for every settlement-only figure. `orderStatus` always reads the LIVE
 * SellerOrder.status, never a snapshot, so it never goes stale relative to
 * /seller/orders.
 */
export type CommissionRow = {
  id: string;
  settlementId: string | null;
  orderDateTime: string;
  orderId: string;
  financialStatus: string;
  shippingState: string;
  productName: string;
  shopName: string;
  customerName: string;
  customerType: string;
  productPrice: number;
  netSalesAfterDeductions: number | null;
  fulfilledQty: number;
  netSalesExclTax: number | null;
  orderStatus: string;
  productPriceIncTax: number | null;
  /** Settlement's calculated total sales once delivered; otherwise the item's own already-stored subtotal+taxAmount (no new formula — just reading two existing snapshot fields). */
  totalSales: number;
  gstRatePercent: number;
  gstTax: number | null;
  categories: string | null;
  commissionValuePercent: number | null;
  grossCommission: number | null;
  grossCommissionTax: number | null;
  logistic: number | null;
  logisticTax: number | null;
  collectionCharge: number | null;
  collectionChargeTax: number | null;
  /** Order-level combined shipment weight (grams) this line's logistics allocation was computed against — same value on every line of the same seller order. Null until the item has a real settlement row. */
  totalShipmentWeightGrams: number | null;
  /** Human-readable description of the matched logistics slab (e.g. "500–2000g @ ₹100" or "Above max @ ₹150") — built from SellerSettlement.logisticsSlabSnapshot. Null until settled, or if the seller-order logistics calculation needed review. */
  logisticsSlab: string | null;
  tcs: number | null;
  tds: number | null;
  paymentMethod: string;
  transactionStatus: string;
  payableToSeller: number | null;
  netPayable: number | null;
  adjustmentCount: number;
  deliveredAt: string | null;
};

/** Formats SellerSettlement.logisticsSlabSnapshot (see settlement-order-calculator.ts:buildSlabSnapshot) into a short, human-readable string for the table/export. */
function formatLogisticsSlab(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.price !== "number") return null;
  if (s.aboveMax) return `Above max @ ₹${s.price}`;
  if (typeof s.lowerWeightGrams === "number" && typeof s.upperWeightGrams === "number") {
    return `${s.lowerWeightGrams}–${s.upperWeightGrams}g @ ₹${s.price}`;
  }
  return null;
}

export function serializeCommissionRow(row: RawCommissionRow): CommissionRow {
  const s = row.settlement;
  const adjustmentTotal = s ? s.adjustments.reduce((sum, a) => sum + Number(a.amount), 0) : 0;

  return {
    id: row.id,
    settlementId: s ? s.id : null,
    orderDateTime: row.sellerOrder.createdAt.toISOString(),
    orderId: row.sellerOrder.orderNumber,
    financialStatus: s
      ? s.financialStatusSnapshot
      : (row.sellerOrder.paymentAllocations[0]?.payment.status ?? "PENDING"),
    shippingState: s
      ? s.shippingStateSnapshot
      : (row.sellerOrder.checkoutGroup.addressSnapshot?.state ?? ""),
    productName: s ? s.productNameSnapshot : row.productName,
    shopName: s ? s.shopNameSnapshot : row.sellerOrder.seller.shopName,
    customerName: s ? s.customerNameSnapshot : (getFullName(row.sellerOrder.customer) ?? "Customer"),
    customerType: s ? s.customerTypeSnapshot : row.sellerOrder.customerType,
    productPrice: s ? Number(s.unitPrice) : Number(row.unitPrice),
    netSalesAfterDeductions: s ? Number(s.unitPriceNetOfDeductions) : null,
    fulfilledQty: row.quantity,
    netSalesExclTax: s ? Number(s.netSalesExclTax) : null,
    orderStatus: row.sellerOrder.status,
    productPriceIncTax: s ? Number(s.unitPriceIncTax) : null,
    totalSales: s ? Number(s.totalSales) : round2(Number(row.subtotal) + Number(row.taxAmount)),
    gstRatePercent: s ? Number(s.gstRatePercent) : Number(row.taxRatePercent),
    gstTax: s ? Number(s.gstTax) : null,
    categories: s ? s.commissionType : null,
    commissionValuePercent: s ? Number(s.commissionValuePercent) : null,
    grossCommission: s ? Number(s.grossCommission) : null,
    grossCommissionTax: s ? Number(s.grossCommissionTax) : null,
    logistic: s ? Number(s.logisticSellerBorne) : null,
    logisticTax: s ? Number(s.logisticTax) : null,
    collectionCharge: s ? Number(s.collectionCharge) : null,
    collectionChargeTax: s ? Number(s.collectionChargeTax) : null,
    totalShipmentWeightGrams: s ? s.sellerOrderTotalWeightGrams : null,
    logisticsSlab: s ? formatLogisticsSlab(s.logisticsSlabSnapshot) : null,
    tcs: s ? Number(s.tcsAmount) : null,
    tds: s ? Number(s.tdsAmount) : null,
    paymentMethod: row.sellerOrder.paymentMethod,
    transactionStatus: s ? s.status : AWAITING_DELIVERY,
    payableToSeller: s ? Number(s.payableToSeller) : null,
    netPayable: s ? round2(Number(s.payableToSeller) + adjustmentTotal) : null,
    adjustmentCount: s ? s.adjustments.length : 0,
    deliveredAt: s?.deliveredAt ? s.deliveredAt.toISOString() : null,
  };
}

export type SerializedSettlementSummary = SettlementSummary;

export function serializeSettlementSummary(
  summary: SettlementSummary,
): SerializedSettlementSummary {
  return summary; // already plain numbers — getSettlementSummary never returns Decimal instances
}
