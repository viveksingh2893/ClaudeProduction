/**
 * Server-side settlement Excel export — the single service both the seller
 * and admin export routes call, so the two surfaces can never drift apart
 * (same authorization/scope, same headings, same formatting). Generates a
 * real .xlsx (never a renamed .csv) via exceljs's streaming
 * `WorkbookWriter`, reading rows from the DB in batches
 * (`iterateAllSettlements`) rather than loading the full filtered result
 * set into memory at once — see that generator's doc comment.
 */
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { prisma } from "@kisan4u/db";
import { iterateAllSettlements, type SettlementFilters } from "./settlement";

// Exact headings and order required by the task — preserved even though
// the underlying database uses clearer field names (see settlement.ts's
// column-mapping doc comment for what each one is sourced from).
const HEADINGS = [
  "Order DateTime",
  "Order ID",
  "Financial Status",
  "Shipping State",
  "Product Name",
  "Shop Name",
  "Customer Name",
  "Customer Type",
  "Product Price",
  "Net Sales After All Deductions",
  "Fulfilled Qty",
  "Net Sales (Excl. Tax)",
  "Order Status",
  "Product Price Inc(Tax)",
  "Total Sales",
  "GST Rate",
  "GST Tax",
  "Categories",
  "Commission Value",
  "Gross Commission",
  "Gross Commission Tax",
  "Total Shipment Weight",
  "Logistics Slab",
  "Allocated Logistics Charge",
  "Allocated Logistics Tax",
  "Allocated Collection Charge",
  "Allocated Collection Tax",
  "Tcs",
  "Tds",
  "Payment Method",
  "Transaction Status",
  "Payable to seller",
  "Delivered On",
] as const;

const MONEY_FMT = "#,##0.00";
const PERCENT_FMT = '0.00"%"';
const DATE_FMT = "dd-mmm-yy hh:mm AM/PM";

type ColumnDef = { header: string; key: string; width: number; style?: Partial<ExcelJS.Style> };

// Keys line up 1:1, in order, with HEADINGS above — kept as a flat parallel
// array (rather than indexing HEADINGS[N]) so inserting/renaming a heading
// can never silently desync a column's header text from its data key.
const COLUMN_KEYS_WIDTHS_STYLES: [key: string, width: number, style?: Partial<ExcelJS.Style>][] = [
  ["orderDateTime", 18, { numFmt: DATE_FMT }],
  ["orderId", 20],
  ["financialStatus", 14],
  ["shippingState", 16],
  ["productName", 32],
  ["shopName", 22],
  ["customerName", 18],
  ["customerType", 12],
  ["productPrice", 13, { numFmt: MONEY_FMT }],
  ["netSalesAfterDeductions", 15, { numFmt: MONEY_FMT }],
  ["fulfilledQty", 12],
  ["netSalesExclTax", 15, { numFmt: MONEY_FMT }],
  ["orderStatus", 16],
  ["productPriceIncTax", 15, { numFmt: MONEY_FMT }],
  ["totalSales", 13, { numFmt: MONEY_FMT }],
  ["gstRate", 10, { numFmt: PERCENT_FMT }],
  ["gstTax", 12, { numFmt: MONEY_FMT }],
  ["categories", 13],
  ["commissionValue", 13, { numFmt: PERCENT_FMT }],
  ["grossCommission", 14, { numFmt: MONEY_FMT }],
  ["grossCommissionTax", 16, { numFmt: MONEY_FMT }],
  ["totalShipmentWeightGrams", 16],
  ["logisticsSlab", 22],
  ["logistic", 16, { numFmt: MONEY_FMT }],
  ["logisticTax", 16, { numFmt: MONEY_FMT }],
  ["collectionCharges", 16, { numFmt: MONEY_FMT }],
  ["collectionChargesTax", 16, { numFmt: MONEY_FMT }],
  ["tcs", 10, { numFmt: MONEY_FMT }],
  ["tds", 10, { numFmt: MONEY_FMT }],
  ["paymentMethod", 18],
  ["transactionStatus", 16],
  ["payableToSeller", 15, { numFmt: MONEY_FMT }],
  ["deliveredOn", 18, { numFmt: DATE_FMT }],
];

const COLUMNS: ColumnDef[] = HEADINGS.map((header, i) => {
  const [key, width, style] = COLUMN_KEYS_WIDTHS_STYLES[i]!;
  return { header, key, width, style };
});

const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@"];

/** Defensive guard against formula injection (OWASP CSV/Excel injection) — a user-controlled string starting with =, +, -, or @ is prefixed with a literal apostrophe so no spreadsheet application ever interprets it as a formula. */
function safeText(value: string): string {
  if (value.length > 0 && FORMULA_INJECTION_PREFIXES.includes(value[0]!)) return `'${value}`;
  return value;
}

/** Formats SellerSettlement.logisticsSlabSnapshot (see settlement-order-calculator.ts:buildSlabSnapshot) into a short description — "—" for a legacy/pre-allocation row or one whose seller-order logistics calculation needed review (null snapshot). */
function formatLogisticsSlab(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object") return "—";
  const s = snapshot as Record<string, unknown>;
  if (typeof s.price !== "number") return "—";
  if (s.aboveMax) return `Above max @ ₹${s.price}`;
  if (typeof s.lowerWeightGrams === "number" && typeof s.upperWeightGrams === "number") {
    return `${s.lowerWeightGrams}–${s.upperWeightGrams}g @ ₹${s.price}`;
  }
  return "—";
}

export type GenerateSettlementWorkbookResult = {
  stream: NodeJS.ReadableStream;
  filename: string;
};

/**
 * Streams a real .xlsx workbook of every settlement matching `filters` for
 * `sellerId` (the caller — the seller's own route, or the admin route
 * scoped to one seller's [id] param — is entirely responsible for
 * authorization; this function trusts `sellerId` completely and applies no
 * auth of its own, matching every other settlement query in this package).
 * Exports ALL matching rows, not just one page. Produces a valid workbook
 * (header row only) for an empty result set.
 */
export async function generateSettlementWorkbook(
  sellerId: string,
  filters: SettlementFilters,
): Promise<GenerateSettlementWorkbookResult> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { slug: true },
  });
  const label = seller?.slug ?? sellerId;
  const dateRange =
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom ?? "start"}_${filters.dateTo ?? "end"}`
      : "all-time";
  const filename = `${label}_settlements_${dateRange}.xlsx`;

  const passThrough = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: passThrough, useStyles: true });
  const sheet = workbook.addWorksheet("Settlements", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0E4" } };
  sheet.getRow(1).commit();
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  // Fire-and-forget on purpose: the caller streams `stream` (the PassThrough)
  // directly to the HTTP response as it's written, rather than waiting for
  // the whole workbook to finish — that's what keeps memory bounded for a
  // large export. Errors surface on `passThrough`'s 'error' event, which
  // the route handler must listen for.
  (async () => {
    try {
      for await (const batch of iterateAllSettlements(sellerId, filters)) {
        for (const row of batch) {
          const adjustmentTotal = row.adjustments.reduce((sum, a) => sum + Number(a.amount), 0);
          const netPayable =
            Math.round((Number(row.payableToSeller) + adjustmentTotal) * 100) / 100;
          sheet
            .addRow({
              orderDateTime: row.orderDateTime,
              orderId: safeText(row.sellerOrder.orderNumber),
              financialStatus: row.financialStatusSnapshot,
              shippingState: safeText(row.shippingStateSnapshot),
              productName: safeText(row.productNameSnapshot),
              shopName: safeText(row.shopNameSnapshot),
              customerName: safeText(row.customerNameSnapshot),
              customerType: row.customerTypeSnapshot,
              productPrice: Number(row.unitPrice),
              netSalesAfterDeductions: Number(row.unitPriceNetOfDeductions),
              fulfilledQty: row.fulfilledQty,
              netSalesExclTax: Number(row.netSalesExclTax),
              orderStatus: row.orderStatusSnapshot,
              productPriceIncTax: Number(row.unitPriceIncTax),
              totalSales: Number(row.totalSales),
              gstRate: Number(row.gstRatePercent),
              gstTax: Number(row.gstTax),
              categories: row.commissionType,
              commissionValue: Number(row.commissionValuePercent),
              grossCommission: Number(row.grossCommission),
              grossCommissionTax: Number(row.grossCommissionTax),
              totalShipmentWeightGrams: row.sellerOrderTotalWeightGrams,
              logisticsSlab: safeText(formatLogisticsSlab(row.logisticsSlabSnapshot)),
              logistic: Number(row.logisticSellerBorne),
              logisticTax: Number(row.logisticTax),
              collectionCharges: Number(row.collectionCharge),
              collectionChargesTax: Number(row.collectionChargeTax),
              tcs: Number(row.tcsAmount),
              tds: Number(row.tdsAmount),
              paymentMethod: row.paymentMethodSnapshot,
              transactionStatus: row.status,
              payableToSeller: netPayable,
              // Null (blank cell) for a legacy row with no trustworthy
              // delivery timestamp — never an invented date.
              deliveredOn: row.deliveredAt ?? null,
            })
            .commit();
        }
      }
      await workbook.commit();
    } catch (err) {
      passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return { stream: passThrough, filename };
}
