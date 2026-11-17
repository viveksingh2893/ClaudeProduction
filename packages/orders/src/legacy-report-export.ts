/**
 * Server-side "legacy-style" admin reports — the Order Report (one row per
 * SellerOrder) and the Product Wise Report (one row per OrderItem),
 * reproducing the column layout of the old KisanBazar Excel exports so the
 * ops / accounts team keeps the report shape they already work with.
 *
 * Both are real `.xlsx` files streamed with exceljs's `WorkbookWriter`,
 * reading orders from the DB in id-cursor batches rather than loading the
 * whole date range into memory — same streaming shape as
 * settlement-export.ts (see that file's doc comment).
 *
 * Column-source decisions (confirmed with the product owner):
 *  - Order ID          -> SellerOrder.orderNumber (K4U-…-S1)
 *  - Customer Type     -> "Farmer" (CUSTOMER) / "Dealer" (DEALER)
 *  - Order Status      -> clean Title Case of the real OrderStatus enum
 *  - Payment Status    -> derived: Unpaid / Partial / Paid from allocations
 *  - Order Total (OR)  -> netPayableForOrder() (real customer-facing total)
 *  - Order Total (PW)  -> per-line total incl. GST = round2(price*qty*(1+gst%))
 *  - BC Name           -> always blank (no equivalent in the new system)
 *  - Remark            -> most recent OrderNote body, else blank
 *  - Agent Name        -> SellerOrder.placedByName (POS), or the BA's own name for a BA order, else "-"
 *  - HSN Number (PW)   -> live ProductVariant.hsnCode ?? Product.hsnCode
 *  - Scope             -> every SellerOrder in the date range, ALL statuses
 *                         (including PENDING_PAYMENT)
 */
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { prisma, getFullName, type Prisma } from "@kisan4u/db";
import { round2 } from "./money";
import { paidSoFarFor, netPayableForOrder } from "./payment-collection";

export type ReportDateFilters = {
  /** Inclusive lower bound, `YYYY-MM-DD`, interpreted at 00:00 IST. */
  dateFrom?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`, interpreted at 23:59:59.999 IST. */
  dateTo?: string;
};

export type GenerateReportWorkbookResult = {
  stream: NodeJS.ReadableStream;
  filename: string;
};

const XLSX_DATE_FMT = "dd/mm/yyyy";
const MONEY_FMT = "#,##0.00";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * exceljs converts a Date to an Excel serial purely from its UTC epoch
 * milliseconds (no timezone handling). Shift by +05:30 and floor to
 * midnight so the cell's serial is the *whole* IST calendar day the order
 * was placed on — matches the legacy report's date-only "Order Date"
 * column, and the value is never read back as a timestamp.
 */
function istDateCell(d: Date): Date {
  const shifted = d.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (shifted % 86_400_000));
}

const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@"];

/**
 * Defensive guard against spreadsheet formula injection (OWASP CSV/Excel
 * injection) — a user-controlled string starting with =, +, -, or @ is
 * prefixed with a literal apostrophe so no spreadsheet application ever
 * interprets it as a formula. Same helper as settlement-export.ts.
 */
function safeText(value: string): string {
  if (value.length > 0 && FORMULA_INJECTION_PREFIXES.includes(value[0]!)) return `'${value}`;
  return value;
}

/**
 * `YYYY-MM-DD` (and nothing else) — the API routes reject anything that
 * doesn't match before calling in here, but this is also the single place
 * that defines the accepted shape.
 */
export const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the `YYYY-MM-DD` filter strings into a Prisma `createdAt` filter,
 * anchoring each end to IST (UTC+05:30) so "7 Sep" means the whole Indian
 * calendar day, not a UTC day that starts at 05:30 IST.
 */
function istCreatedAtFilter(filters: ReportDateFilters): Prisma.DateTimeFilter | undefined {
  const { dateFrom, dateTo } = filters;
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000+05:30`) } : {}),
    ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+05:30`) } : {}),
  };
}

function dateRangeLabel(filters: ReportDateFilters): string {
  if (!filters.dateFrom && !filters.dateTo) return "all-time";
  return `${filters.dateFrom ?? "start"}_to_${filters.dateTo ?? "end"}`;
}

const ORDER_INCLUDE = {
  seller: { select: { shopName: true } },
  customer: {
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      dealerProfile: { select: { storeName: true, gstNumber: true } },
    },
  },
  checkoutGroup: {
    select: {
      addressSnapshot: true,
      // A BA-approved order's placedByName is the literal "Business
      // Associate" — the report names the actual BA instead.
      placedByUser: { select: { baProfile: { select: { firstName: true, lastName: true } } } },
    },
  },
  charge: { select: { customerPayableTotal: true } },
  paymentAllocations: {
    select: {
      amount: true,
      remainingCollectedAmount: true,
      payment: { select: { amountPaid: true, totalAmount: true } },
    },
  },
  notes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
  items: {
    select: {
      productId: true,
      variantId: true,
      productName: true,
      variantLabel: true,
      sku: true,
      unitPrice: true,
      quantity: true,
      taxRatePercent: true,
    },
  },
} satisfies Prisma.SellerOrderInclude;

type ReportOrder = Prisma.SellerOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * All SellerOrders whose `createdAt` falls in the range, oldest first,
 * yielded in id-cursor batches so a large export never holds the whole
 * result set in memory at once.
 */
async function* iterateReportOrders(
  where: Prisma.SellerOrderWhereInput,
): AsyncGenerator<ReportOrder[]> {
  const batchSize = 200;
  let cursorId: string | undefined;
  for (;;) {
    const batch = await prisma.sellerOrder.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });
    if (batch.length === 0) return;
    yield batch;
    if (batch.length < batchSize) return;
    cursorId = batch[batch.length - 1]!.id;
  }
}

// --- Shared per-order cell values -------------------------------------------

const CUSTOMER_TYPE_LABEL: Record<string, string> = { CUSTOMER: "Farmer", DEALER: "Dealer" };
const DELIVERY_METHOD_LABEL: Record<string, string> = {
  KISAN4U_COURIER: "Courier",
  TRANSPORT: "Transport",
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  COD: "Cash On Delivery",
  ONLINE_FULL: "Prepaid",
  ONLINE_PARTIAL: "Partial Prepaid",
  WALLET: "Wallet",
  TRANSPORT_FULL_ONLINE: "Prepaid (Transport)",
};

/** "PENDING_PAYMENT" -> "Pending Payment", "IN_TRANSIT" -> "In Transit". */
function titleCaseEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** POS staff name, or the Business Associate's own name for a BA-approved order; "-" is our own literal fallback (not user data), so it skips the formula-injection guard. */
function agentNameFor(order: ReportOrder): string {
  const ba = order.checkoutGroup.placedByUser?.baProfile;
  if (ba) return safeText(`${ba.firstName} ${ba.lastName}`.trim());
  return order.placedByName ? safeText(order.placedByName) : "-";
}

function paymentStatusLabel(order: ReportOrder): string {
  const net = netPayableForOrder(order);
  const paid = paidSoFarFor(order.paymentAllocations);
  if (paid <= 0.005) return "Unpaid";
  if (paid + 0.005 >= net) return "Paid";
  return "Partial";
}

function customerName(order: ReportOrder): string {
  const snapshotName = order.checkoutGroup.addressSnapshot?.fullName?.trim();
  if (order.customerType === "DEALER") {
    const store = order.customer.dealerProfile?.storeName?.trim();
    if (store) return store;
  }
  return getFullName(order.customer) ?? snapshotName ?? order.customer.phone ?? "—";
}

function composedAddress(order: ReportOrder): string {
  const s = order.checkoutGroup.addressSnapshot;
  if (!s) return "";
  return [s.line1, s.line2, s.landmark, s.cityTown, s.district, s.state, s.pincode]
    .map((p) => p?.toString().trim())
    .filter(Boolean)
    .join(", ");
}

/** The columns shared by both reports, in report order, up to (not incl.) HSN. */
function commonHeadCells(order: ReportOrder) {
  const snapshot = order.checkoutGroup.addressSnapshot;
  return {
    orderDate: istDateCell(order.createdAt),
    orderId: safeText(order.orderNumber),
    sellerName: safeText(order.seller.shopName),
    invoiceNumber: safeText(order.invoiceNumber ?? ""),
    customerType: CUSTOMER_TYPE_LABEL[order.customerType] ?? order.customerType,
    orderStatus: titleCaseEnum(order.status),
    paymentMethod: PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod,
    paymentStatus: paymentStatusLabel(order),
    customerName: safeText(customerName(order)),
    bcName: "",
    gstNumber: safeText(order.customer.dealerProfile?.gstNumber ?? ""),
    mobileNumber: safeText(snapshot?.mobile ?? order.customer.phone ?? ""),
    email: safeText(order.customer.email ?? ""),
    address: safeText(composedAddress(order)),
    pincode: safeText(snapshot?.pincode ?? ""),
    state: safeText(snapshot?.state ?? ""),
    deliveryType: DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod,
  };
}

// --- Workbook plumbing -----------------------------------------------------

type ColumnDef = { header: string; key: string; width: number; style?: Partial<ExcelJS.Style> };

function newWorkbook(sheetName: string, columns: ColumnDef[]) {
  const passThrough = new PassThrough();
  // useSharedStrings — these exports run to tens of thousands of rows with
  // heavily repeated seller names / addresses / statuses; interning them
  // keeps the file a fraction of the inline-string size.
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: passThrough,
    useStyles: true,
    useSharedStrings: true,
  });
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0E4" } };
  sheet.getRow(1).commit();
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return { passThrough, workbook, sheet };
}

// --- Order Report --------------------------------------------------------

const ORDER_REPORT_COLUMNS: ColumnDef[] = [
  { header: "SL", key: "sl", width: 6 },
  { header: "Order Date", key: "orderDate", width: 13, style: { numFmt: XLSX_DATE_FMT } },
  { header: "Order ID", key: "orderId", width: 22 },
  { header: "Seller Name", key: "sellerName", width: 34 },
  { header: "Invoice Number", key: "invoiceNumber", width: 20 },
  { header: "Customer Type", key: "customerType", width: 13 },
  { header: "Order Status", key: "orderStatus", width: 16 },
  { header: "Payment Method", key: "paymentMethod", width: 16 },
  { header: "Payment Status", key: "paymentStatus", width: 13 },
  { header: "Customer Name", key: "customerName", width: 26 },
  { header: "BC Name", key: "bcName", width: 14 },
  { header: "GST Number", key: "gstNumber", width: 18 },
  { header: "Mobile Number", key: "mobileNumber", width: 15 },
  { header: "Email", key: "email", width: 22 },
  { header: "Address", key: "address", width: 44 },
  { header: "Pincode", key: "pincode", width: 10 },
  { header: "State", key: "state", width: 16 },
  { header: "Delivery Type", key: "deliveryType", width: 13 },
  { header: "Number Of Products", key: "numberOfProducts", width: 16 },
  { header: "Order Total", key: "orderTotal", width: 13, style: { numFmt: MONEY_FMT } },
  { header: "Remark", key: "remark", width: 26 },
  { header: "Agent Name", key: "agentName", width: 18 },
];

export async function generateOrderReportWorkbook(
  filters: ReportDateFilters,
): Promise<GenerateReportWorkbookResult> {
  const where: Prisma.SellerOrderWhereInput = {};
  const createdAt = istCreatedAtFilter(filters);
  if (createdAt) where.createdAt = createdAt;

  const { passThrough, workbook, sheet } = newWorkbook("Order Report", ORDER_REPORT_COLUMNS);
  const filename = `order-report_${dateRangeLabel(filters)}.xlsx`;

  // Fire-and-forget on purpose — the caller pipes `stream` straight to the
  // HTTP response as rows are written; errors surface on the PassThrough's
  // 'error' event, which the route handler listens for.
  (async () => {
    try {
      let sl = 0;
      for await (const batch of iterateReportOrders(where)) {
        for (const order of batch) {
          sl += 1;
          const common = commonHeadCells(order);
          sheet
            .addRow({
              sl,
              ...common,
              numberOfProducts: order.items.reduce((n, i) => n + i.quantity, 0),
              orderTotal: round2(netPayableForOrder(order)),
              remark: safeText(order.notes[0]?.body ?? ""),
              // "-" is our own literal fallback, not user data — don't let
              // the formula-injection guard turn it into a quoted "'-".
              agentName: agentNameFor(order),
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

// --- Product Wise Report ------------------------------------------------

const PRODUCT_WISE_COLUMNS: ColumnDef[] = [
  { header: "SL", key: "sl", width: 6 },
  { header: "Order Date", key: "orderDate", width: 13, style: { numFmt: XLSX_DATE_FMT } },
  { header: "Order ID", key: "orderId", width: 22 },
  { header: "Seller Name", key: "sellerName", width: 34 },
  { header: "Invoice Number", key: "invoiceNumber", width: 20 },
  { header: "Customer Type", key: "customerType", width: 13 },
  { header: "Order Status", key: "orderStatus", width: 16 },
  { header: "Payment Method", key: "paymentMethod", width: 16 },
  { header: "Payment Status", key: "paymentStatus", width: 13 },
  { header: "Customer Name", key: "customerName", width: 26 },
  { header: "BC Name", key: "bcName", width: 14 },
  { header: "GST Number", key: "gstNumber", width: 18 },
  { header: "HSN Number", key: "hsnNumber", width: 14 },
  { header: "Mobile Number", key: "mobileNumber", width: 15 },
  { header: "Email", key: "email", width: 22 },
  { header: "Address", key: "address", width: 44 },
  { header: "Pincode", key: "pincode", width: 10 },
  { header: "State", key: "state", width: 16 },
  { header: "Delivery Type", key: "deliveryType", width: 13 },
  { header: "Product name", key: "productName", width: 34 },
  { header: "Variant Name", key: "variantName", width: 18 },
  { header: "SKU", key: "sku", width: 22 },
  { header: "Price", key: "price", width: 12, style: { numFmt: MONEY_FMT } },
  { header: "Qty", key: "qty", width: 8 },
  { header: "Total", key: "total", width: 13, style: { numFmt: MONEY_FMT } },
  { header: "GST Percentage", key: "gstPercentage", width: 13 },
  { header: "Order Total", key: "orderTotal", width: 13, style: { numFmt: MONEY_FMT } },
];

/**
 * HSN per line: the variant's own `hsnCode` if it has diverged from the
 * parent, else the product's. Batch-loaded per order batch so we never
 * issue a query per line item.
 */
async function hsnLookupForBatch(orders: ReportOrder[]) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.productId) productIds.add(item.productId);
      if (item.variantId) variantIds.add(item.variantId);
    }
  }
  const [products, variants] = await Promise.all([
    productIds.size
      ? prisma.product.findMany({
          where: { id: { in: [...productIds] } },
          select: { id: true, hsnCode: true },
        })
      : Promise.resolve([]),
    variantIds.size
      ? prisma.productVariant.findMany({
          where: { id: { in: [...variantIds] } },
          select: { id: true, hsnCode: true },
        })
      : Promise.resolve([]),
  ]);
  const productHsn = new Map(products.map((p) => [p.id, p.hsnCode]));
  const variantHsn = new Map(variants.map((v) => [v.id, v.hsnCode]));
  return (productId: string, variantId: string | null): string => {
    const fromVariant = variantId ? variantHsn.get(variantId) : null;
    return (fromVariant || productHsn.get(productId) || "").toString();
  };
}

export async function generateProductWiseReportWorkbook(
  filters: ReportDateFilters,
): Promise<GenerateReportWorkbookResult> {
  const where: Prisma.SellerOrderWhereInput = {};
  const createdAt = istCreatedAtFilter(filters);
  if (createdAt) where.createdAt = createdAt;

  const { passThrough, workbook, sheet } = newWorkbook("Product Wise Report", PRODUCT_WISE_COLUMNS);
  const filename = `product-wise-report_${dateRangeLabel(filters)}.xlsx`;

  (async () => {
    try {
      let sl = 0;
      for await (const batch of iterateReportOrders(where)) {
        const hsnFor = await hsnLookupForBatch(batch);
        for (const order of batch) {
          const common = commonHeadCells(order);
          for (const item of order.items) {
            sl += 1;
            const price = round2(Number(item.unitPrice));
            const gstPct = Number(item.taxRatePercent);
            const total = round2(price * item.quantity);
            sheet
              .addRow({
                sl,
                ...common,
                hsnNumber: safeText(hsnFor(item.productId, item.variantId)),
                productName: safeText(item.productName),
                variantName: safeText(item.variantLabel ?? ""),
                sku: safeText(item.sku),
                price,
                qty: item.quantity,
                total,
                gstPercentage: gstPct,
                orderTotal: round2(total * (1 + gstPct / 100)),
              })
              .commit();
          }
        }
      }
      await workbook.commit();
    } catch (err) {
      passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return { stream: passThrough, filename };
}
