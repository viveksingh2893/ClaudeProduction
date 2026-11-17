/**
 * Legacy DEALER order-history migration — sibling of migrate-legacy-orders.ts
 * (customer-side), same source TSVs, same grouping/mapping logic, scoped to
 * DEALER instead of CUSTOMER. See that script's module doc comment for the
 * full rationale behind every design decision reused verbatim here
 * (order_details.seller_id vs orders.seller_id reliability, multi-seller
 * order splitting, order_group_id -> CheckoutGroup mapping, why no
 * OrderCharge/Payment rows, why this never touches settlement, the
 * per-line financial-total simplifications, tax-is-a-line-total).
 *
 * WHY THE SAME orders_migrated_sellers.tsv / order_details_migrated_sellers.tsv
 * FILES WORK HERE UNCHANGED: that export was scoped only by
 * order_details.seller_id (the 11 already-migrated sellers) — never
 * filtered by customer type. `orders.customer_type` is "customer" on
 * every row sitewide regardless of whether the buyer is a real customer
 * or a dealer (confirmed directly), so the only real signal for "is this
 * a dealer's order" is whether `orders.customer_id` resolves to a User
 * migrated by migrate-legacy-dealers.ts. Running this script against the
 * exact same files the customer order migration used is safe by
 * construction: an order whose customer_id belongs to a real customer
 * fails this script's DEALER-scoped lookup and lands in
 * skippedNoCustomer here, exactly the same safety net that already
 * proved out for dealer orders during the customer migration's own run
 * (verified directly against its skippedNoCustomer diagnostic before any
 * dealer account existed).
 *
 * SCOPE: only dealers already migrated by migrate-legacy-dealers.ts
 * (User.legacyId starting with "DEALER:") and only the 11 already-
 * migrated sellers (LEGACY_SELLER_ID_TO_SHOPNAME below, identical set).
 *
 * Idempotent rerun: same keys as the customer script (legacyGroupId,
 * (legacyOrderId, legacySellerId), legacyOrderDetailId) — these are
 * global unique columns shared across both scripts' output, so there is
 * zero collision risk between the two even though they may process
 * overlapping raw TSV rows (each row only ever resolves successfully
 * against ONE of the two customer/dealer User maps).
 *
 * Usage:
 *   tsx prisma/migrate-legacy-dealer-orders.ts --dry-run \
 *     --orders-file ./legacy-export/orders_migrated_sellers.tsv \
 *     --details-file ./legacy-export/order_details_migrated_sellers.tsv
 *   tsx prisma/migrate-legacy-dealer-orders.ts \
 *     --orders-file ./legacy-export/orders_migrated_sellers.tsv \
 *     --details-file ./legacy-export/order_details_migrated_sellers.tsv
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient, OrderStatus, PaymentMethod, AddressKind, UserRole } from "../generated/prisma/client";
import type { IndianState } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Identical set to migrate-legacy-orders.ts — the 11 sellers migrated so far.
const LEGACY_SELLER_ID_TO_SHOPNAME: Record<string, string> = {
  "27": "Katra",
  "29": "Royal Traders",
  "153": "Aries Agro Limited",
  "59": "Geolife Agritech India Private Limited",
  "142": "HIFIELD AG CHEM INDIA PVT LTD",
  "202": "HIFIELD ORGANICS INC",
  "124": "Kay Bee Bio-Organics Pvt. Ltd",
  "237": "Sarvin Agro Chemicals Private Limited",
  "232": "Shurbans international Pvt Ltd",
  "137": "TITAN AGRITECH LIMITED",
  "236": "TORRENT CROP SCIENCE",
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Args = { ordersFile: string; detailsFile: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  let ordersFile = "";
  let detailsFile = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--orders-file") ordersFile = argv[++i]!;
    else if (arg.startsWith("--orders-file=")) ordersFile = arg.slice("--orders-file=".length);
    else if (arg === "--details-file") detailsFile = argv[++i]!;
    else if (arg.startsWith("--details-file=")) detailsFile = arg.slice("--details-file=".length);
  }
  const missing = [!ordersFile && "--orders-file", !detailsFile && "--details-file"].filter(
    (v): v is string => !!v,
  );
  if (missing.length > 0) throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
  return { ordersFile, detailsFile, dryRun };
}

// ---------------------------------------------------------------------------
// TSV parsing / helpers — identical to migrate-legacy-orders.ts
// ---------------------------------------------------------------------------

function parseTsv(path: string): Record<string, string>[] {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.replace(/\r$/, "").split("\t");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.replace(/\r$/, "").split("\t");
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]!] = cells[c] ?? "";
    rows.push(row);
  }
  return rows;
}

function cell(row: Record<string, string>, key: string): string | undefined {
  const v = row[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.toUpperCase() === "NULL") return undefined;
  return t;
}

function toInt(raw: unknown, fallback = 0): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(raw: unknown, fallback = 0): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function toDecimalString(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}

function safeJsonObject(raw: string | undefined): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseLegacyDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// ---------------------------------------------------------------------------
// State normalization — identical to migrate-legacy-orders.ts
// ---------------------------------------------------------------------------

const STATE_ALIASES: Record<string, string> = {
  orissa: "odisha",
  pondicherry: "puducherry",
  uttaranchal: "uttarakhand",
  "nct of delhi": "delhi",
  "new delhi": "delhi",
  "delhi ncr": "delhi",
  "west bangal": "west bengal",
  "west benga": "west bengal",
  telagana: "telangana",
  gujrat: "gujarat",
  maharashtara: "maharashtra",
  maharastra: "maharashtra",
  maharshtra: "maharashtra",
  mharashtra: "maharashtra",
  mahatashtra: "maharashtra",
  mahatashtara: "maharashtra",
  "utter pradesh": "uttar pradesh",
  uttarpradesh: "uttar pradesh",
  "uttar prades": "uttar pradesh",
  rajsthane: "rajasthan",
  rjasthan: "rajasthan",
  chattisgarh: "chhattisgarh",
  chhatisgarh: "chhattisgarh",
  biharbihar: "bihar",
  panjab: "punjab",
  tamilnadu: "tamil nadu",
  andhrapradesh: "andhra pradesh",
  "madhya prades": "madhya pradesh",
  "madhya prade": "madhya pradesh",
};

function normalizeStateText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStateIndex(states: IndianState[]): Map<string, IndianState> {
  const index = new Map<string, IndianState>();
  for (const s of states) index.set(normalizeStateText(s.name), s);
  return index;
}

function matchState(rawState: string, index: Map<string, IndianState>): IndianState | null {
  const normalized = normalizeStateText(rawState);
  if (!normalized) return null;
  const aliased = STATE_ALIASES[normalized] ?? normalized;
  return index.get(aliased) ?? index.get(normalized) ?? null;
}

// ---------------------------------------------------------------------------
// Status / payment-method mapping — identical to migrate-legacy-orders.ts
// ---------------------------------------------------------------------------

function mapOrderStatus(orderStatus: string | undefined, paymentStatus: string | undefined): {
  status: OrderStatus;
  unmapped: boolean;
} {
  const s = (orderStatus ?? "").toLowerCase().trim();
  const paid = (paymentStatus ?? "").toLowerCase().trim() === "paid";
  switch (s) {
    case "pending":
      return { status: paid ? OrderStatus.CONFIRMED : OrderStatus.PENDING_PAYMENT, unmapped: false };
    case "confirmed":
      return { status: OrderStatus.CONFIRMED, unmapped: false };
    case "processing":
      return { status: OrderStatus.SELLER_ACCEPTED, unmapped: false };
    case "out_for_delivery":
    case "out_for_deliver":
      return { status: OrderStatus.IN_TRANSIT, unmapped: false };
    case "intransit":
      return { status: OrderStatus.IN_TRANSIT, unmapped: false };
    case "delivered":
      return { status: OrderStatus.DELIVERED, unmapped: false };
    case "returned":
      return { status: OrderStatus.RETURN_APPROVED, unmapped: false };
    case "canceled":
    case "cancelled":
      return { status: OrderStatus.CANCELLED, unmapped: false };
    case "failed":
      return { status: OrderStatus.DELIVERY_FAILED, unmapped: false };
    default:
      return { status: OrderStatus.CONFIRMED, unmapped: true };
  }
}

/** Identical rule/rationale to migrate-legacy-orders.ts — owner's explicit decision, 2026-09-17. */
const LEGACY_CLOSED_OUT_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.RETURN_APPROVED,
  OrderStatus.DELIVERY_FAILED,
]);

function legacyDatePart(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function randomSuffix(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function mapPaymentMethod(raw: string | undefined): { method: PaymentMethod; unmapped: boolean } {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s || s.includes("cod") || s.includes("cash")) return { method: PaymentMethod.COD, unmapped: false };
  if (s.includes("wallet")) return { method: PaymentMethod.WALLET, unmapped: false };
  if (s.includes("partial")) return { method: PaymentMethod.ONLINE_PARTIAL, unmapped: false };
  if (
    s.includes("online") ||
    s.includes("razorpay") ||
    s.includes("razor_pay") ||
    s.includes("card") ||
    s.includes("upi") ||
    s.includes("digital") ||
    s.includes("prepaid") // "fullPrepaid" — real value found in dealer order data, not seen during the customer migration
  )
    return { method: PaymentMethod.ONLINE_FULL, unmapped: false };
  return { method: PaymentMethod.COD, unmapped: true };
}

function mapAddressType(raw: string | undefined): AddressKind {
  const s = (raw ?? "").toLowerCase().trim();
  if (s === "home") return AddressKind.HOME;
  if (s === "office" || s === "work") return AddressKind.OFFICE;
  if (s === "farm") return AddressKind.FARM;
  if (s === "shop") return AddressKind.SHOP;
  return AddressKind.HOME;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type LegacyOrderDetail = {
  id: string;
  orderId: string;
  productId: string;
  sellerId: string;
  qty: number;
  price: number;
  discountedPrice: number | null;
  tax: number;
  discountedTax: number | null;
  variant: string | undefined;
  createdAt: Date;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Legacy DEALER order migration${args.dryRun ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  orders file:  ${args.ordersFile}`);
  console.log(`  details file: ${args.detailsFile}`);

  const orderRows = parseTsv(args.ordersFile);
  const detailRows = parseTsv(args.detailsFile);
  console.log(`\nRead ${orderRows.length} order row(s), ${detailRows.length} order-detail row(s).`);

  // --- bulk-load lookup maps ---
  const [dealerUsers, products, variants, dealerConfigs, states, sellers] = await Promise.all([
    prisma.user.findMany({
      where: { legacyId: { startsWith: "DEALER:" } },
      select: { id: true, legacyId: true },
    }),
    prisma.product.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true, name: true, primaryImageUrl: true, baseUnit: true, sku: true, sellerId: true },
    }),
    prisma.productVariant.findMany({
      where: { legacyProductId: { not: null } },
      select: {
        id: true,
        legacyProductId: true,
        legacyVariantType: true,
        sku: true,
        mrp: true,
        imageUrl: true,
        weight: true,
        values: { select: { attributeValue: { select: { value: true, attribute: { select: { name: true } } } } } },
      },
    }),
    prisma.productDealerConfig.findMany({
      where: { legacyProductId: { not: null } },
      select: { productId: true, legacyProductId: true, legacyVariantType: true, sku: true, mrp: true, weight: true },
    }),
    prisma.indianState.findMany(),
    prisma.sellerProfile.findMany({
      where: { shopName: { in: Object.values(LEGACY_SELLER_ID_TO_SHOPNAME) } },
      select: { id: true, shopName: true },
    }),
  ]);

  // Bare legacy users.id -> new User.id — strips the "DEALER:" prefix so
  // this compares directly against orders.customer_id (a bare legacy id
  // in the TSV, same table regardless of isDealer).
  const userByLegacyId = new Map(
    dealerUsers.map((u) => [u.legacyId!.replace(/^DEALER:/, ""), u.id]),
  );
  const productByLegacyId = new Map(products.map((p) => [p.legacyId!, p]));
  // "DEALER:" prefixed, matching how migrate-legacy-products.ts wrote
  // ProductVariant.legacyVariantType for a dealer-audience variant.
  const variantByKey = new Map(variants.map((v) => [`${v.legacyProductId}:${v.legacyVariantType}`, v]));
  const configByKey = new Map(dealerConfigs.map((c) => [`${c.legacyProductId}:${c.legacyVariantType}`, c]));
  const stateIndex = buildStateIndex(states);
  const sellerIdByShopName = new Map(sellers.map((s) => [s.shopName, s.id]));
  const sellerProfileIdByLegacyId = new Map<string, string>();
  for (const [legacyId, shopName] of Object.entries(LEGACY_SELLER_ID_TO_SHOPNAME)) {
    const id = sellerIdByShopName.get(shopName);
    if (!id) throw new Error(`Expected SellerProfile "${shopName}" (legacy seller ${legacyId}) not found — aborting.`);
    sellerProfileIdByLegacyId.set(legacyId, id);
  }

  console.log(
    `Loaded ${userByLegacyId.size} legacy dealer(s), ${productByLegacyId.size} legacy product(s), ${variantByKey.size} legacy variant(s), ${configByKey.size} legacy dealer config(s), ${sellerProfileIdByLegacyId.size} legacy seller(s).`,
  );

  // --- index order headers by id ---
  const orderById = new Map<string, Record<string, string>>();
  for (const row of orderRows) {
    const id = cell(row, "id");
    if (id) orderById.set(id, row);
  }

  // --- group order_details by (order_id, seller_id) ---
  const groups = new Map<string, LegacyOrderDetail[]>();
  for (const row of detailRows) {
    const id = cell(row, "id");
    const orderId = cell(row, "order_id");
    const productId = cell(row, "product_id");
    const sellerId = cell(row, "seller_id");
    if (!id || !orderId || !productId || !sellerId) continue;
    if (!sellerProfileIdByLegacyId.has(sellerId)) continue;
    const key = `${orderId}:${sellerId}`;
    const detail: LegacyOrderDetail = {
      id,
      orderId,
      productId,
      sellerId,
      qty: toInt(cell(row, "qty"), 1) || 1,
      price: toFloat(cell(row, "price"), 0),
      discountedPrice: cell(row, "discounted_price") ? toFloat(cell(row, "discounted_price")) : null,
      tax: toFloat(cell(row, "tax"), 0),
      discountedTax: cell(row, "discounted_tax") ? toFloat(cell(row, "discounted_tax")) : null,
      variant: cell(row, "variant"),
      createdAt: parseLegacyDate(cell(row, "created_at")),
    };
    const arr = groups.get(key);
    if (arr) arr.push(detail);
    else groups.set(key, [detail]);
  }
  console.log(`Grouped into ${groups.size} (order, seller) SellerOrder candidate(s) (all buyers — dealer-owned ones resolve below, others skip).`);

  const diagnostics = {
    skippedNoOrder: 0,
    skippedNoCustomer: 0, // includes every real-customer-owned order — expected, not an error
    skippedNoLinesResolved: 0,
    unresolvedProducts: new Set<string>(),
    unresolvedVariants: new Set<string>(),
    unmappedOrderStatuses: new Set<string>(),
    unmappedPaymentMethods: new Set<string>(),
    fallbackDistrictCount: 0,
    fallbackAddressCount: 0,
    unresolvedStates: new Set<string>(),
    groupsWritten: 0,
    itemsWritten: 0,
  };

  let processed = 0;
  const totalGroups = groups.size;

  for (const [key, lines] of groups) {
    processed++;
    if (processed % 2000 === 0) console.log(`  ...processed ${processed}/${totalGroups} groups`);

    const [legacyOrderId, legacySellerId] = key.split(":") as [string, string];
    const order = orderById.get(legacyOrderId);
    if (!order) {
      diagnostics.skippedNoOrder++;
      continue;
    }

    const legacyCustomerId = cell(order, "customer_id");
    const customerId = legacyCustomerId ? userByLegacyId.get(legacyCustomerId) : undefined;
    if (!customerId) {
      diagnostics.skippedNoCustomer++;
      continue;
    }

    const sellerProfileId = sellerProfileIdByLegacyId.get(legacySellerId)!;

    type ResolvedLine = {
      detail: LegacyOrderDetail;
      productId: string;
      productName: string;
      productImageUrl: string;
      variantId: string | null;
      variantLabel: string | null;
      sku: string;
      unit: string;
      unitWeightGrams: number;
      mrp: string;
    };
    const resolvedLines: ResolvedLine[] = [];

    for (const detail of lines) {
      const product = productByLegacyId.get(detail.productId);
      if (!product) {
        diagnostics.unresolvedProducts.add(detail.productId);
        continue;
      }
      const rawType = (detail.variant ?? "").trim();
      const variantKey = `${detail.productId}:DEALER:${rawType}`;
      const configKey = `${detail.productId}:`;
      const variant = rawType ? variantByKey.get(variantKey) : undefined;
      const config = !rawType ? configByKey.get(configKey) : undefined;

      if (!variant && !config) {
        diagnostics.unresolvedVariants.add(`${detail.productId}:${rawType}`);
        continue;
      }

      const variantLabel = variant
        ? variant.values.map((v) => `${v.attributeValue.attribute.name}: ${v.attributeValue.value}`).join(", ")
        : null;

      resolvedLines.push({
        detail,
        productId: product.id,
        productName: product.name,
        productImageUrl: variant?.imageUrl ?? product.primaryImageUrl,
        variantId: variant?.id ?? null,
        variantLabel,
        sku: variant?.sku ?? config?.sku ?? product.sku ?? product.id,
        unit: product.baseUnit,
        unitWeightGrams: variant?.weight ?? config?.weight ?? 0,
        mrp: String(variant?.mrp ?? config?.mrp ?? 0),
      });
    }

    if (resolvedLines.length === 0) {
      diagnostics.skippedNoLinesResolved++;
      continue;
    }

    let subtotal = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    for (const rl of resolvedLines) {
      const d = rl.detail;
      const lineSubtotalBeforeDiscount = d.price * d.qty;
      const effectiveUnitPrice = d.discountedPrice ?? d.price;
      const lineDiscount = Math.max(0, (d.price - effectiveUnitPrice) * d.qty);
      const lineTax = d.discountedTax ?? d.tax; // line total, not per-unit — see migrate-legacy-orders.ts
      subtotal += lineSubtotalBeforeDiscount;
      discountAmount += lineDiscount;
      taxAmount += lineTax;
    }
    const totalAmount = subtotal - discountAmount + taxAmount;

    const { status, unmapped: statusUnmapped } = mapOrderStatus(cell(order, "order_status"), cell(order, "payment_status"));
    if (statusUnmapped) diagnostics.unmappedOrderStatuses.add(cell(order, "order_status") ?? "(empty)");
    const { method: paymentMethod, unmapped: methodUnmapped } = mapPaymentMethod(cell(order, "payment_method"));
    if (methodUnmapped) diagnostics.unmappedPaymentMethods.add(cell(order, "payment_method") ?? "(empty)");

    const orderCreatedAt = parseLegacyDate(cell(order, "created_at"));
    const orderUpdatedAt = parseLegacyDate(cell(order, "updated_at"));

    const rawGroupId = cell(order, "order_group_id");
    const legacyGroupId = rawGroupId && rawGroupId !== "def-order-group" ? rawGroupId : `single-${legacyOrderId}`;

    const addrRaw = safeJsonObject(cell(order, "shipping_address_data"));
    if (!addrRaw) diagnostics.fallbackAddressCount++;
    const rawState = addrRaw?.state ? String(addrRaw.state) : "";
    const matchedState = rawState ? matchState(rawState, stateIndex) : null;
    if (rawState && !matchedState) diagnostics.unresolvedStates.add(rawState);
    const city = addrRaw?.city ? String(addrRaw.city) : "Unknown";
    if (!addrRaw?.city) diagnostics.fallbackDistrictCount++;

    if (args.dryRun) {
      diagnostics.groupsWritten++;
      diagnostics.itemsWritten += resolvedLines.length;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const checkoutGroup = await tx.checkoutGroup.upsert({
        where: { legacyGroupId },
        update: {},
        create: {
          groupNumber: `LEGACY-DEALER-${legacyGroupId}`,
          customerId,
          customerType: UserRole.DEALER,
          createdAt: orderCreatedAt,
          legacyGroupId,
        },
      });

      await tx.orderAddressSnapshot.upsert({
        where: { checkoutGroupId: checkoutGroup.id },
        update: {},
        create: {
          checkoutGroupId: checkoutGroup.id,
          fullName: addrRaw?.contact_person_name ? String(addrRaw.contact_person_name) : "Unknown",
          mobile: addrRaw?.phone ? String(addrRaw.phone) : "0000000000",
          line1: addrRaw?.address ? String(addrRaw.address) : "Unknown",
          landmark: addrRaw?.nearby_place ? String(addrRaw.nearby_place) : null,
          cityTown: city,
          district: city,
          state: rawState || "Unknown",
          stateId: matchedState?.id ?? null,
          pincode: addrRaw?.zip ? String(addrRaw.zip) : "000000",
          addressType: mapAddressType(addrRaw?.address_type ? String(addrRaw.address_type) : undefined),
          createdAt: orderCreatedAt,
        },
      });

      const isLegacyClosedOut = LEGACY_CLOSED_OUT_STATUSES.has(status);
      let orderNumber = `LEGACY-DEALER-${legacyOrderId}-${legacySellerId}`;
      if (!isLegacyClosedOut) {
        const date = legacyDatePart(orderCreatedAt);
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `K4U-${date}-${randomSuffix()}-S1`;
          const existing = await tx.sellerOrder.findUnique({
            where: { orderNumber: candidate },
            select: { id: true },
          });
          if (!existing) {
            orderNumber = candidate;
            break;
          }
        }
      }

      const sellerOrder = await tx.sellerOrder.upsert({
        where: { legacyOrderId_legacySellerId: { legacyOrderId, legacySellerId } },
        update: {},
        create: {
          orderNumber,
          checkoutGroupId: checkoutGroup.id,
          customerId,
          sellerId: sellerProfileId,
          customerType: UserRole.DEALER,
          status,
          paymentMethod,
          deliveryMethod: "KISAN4U_COURIER",
          subtotal: toDecimalString(subtotal),
          discountAmount: toDecimalString(discountAmount),
          taxAmount: toDecimalString(taxAmount),
          totalAmount: toDecimalString(totalAmount),
          createdAt: orderCreatedAt,
          updatedAt: orderUpdatedAt,
          legacyOrderId,
          legacySellerId,
          legacyClosedOut: isLegacyClosedOut,
        },
      });

      for (const rl of resolvedLines) {
        const d = rl.detail;
        const effectiveUnitPrice = d.discountedPrice ?? d.price;
        const lineDiscount = Math.max(0, (d.price - effectiveUnitPrice) * d.qty);
        const lineTax = d.discountedTax ?? d.tax;
        const lineSubtotal = d.price * d.qty - lineDiscount;

        await tx.orderItem.upsert({
          where: { legacyOrderDetailId: d.id },
          update: {},
          create: {
            sellerOrderId: sellerOrder.id,
            productId: rl.productId,
            productName: rl.productName,
            productImageUrl: rl.productImageUrl,
            variantId: rl.variantId,
            variantLabel: rl.variantLabel,
            sku: rl.sku,
            quantity: d.qty,
            unit: rl.unit as any,
            unitWeightGrams: rl.unitWeightGrams,
            totalWeightGrams: rl.unitWeightGrams * d.qty,
            mrp: rl.mrp,
            unitPrice: toDecimalString(d.price),
            discountAmount: toDecimalString(lineDiscount),
            taxRatePercent: toDecimalString(d.price * d.qty > 0 ? (lineTax / (d.price * d.qty)) * 100 : 0),
            taxAmount: toDecimalString(lineTax),
            subtotal: toDecimalString(lineSubtotal),
            createdAt: d.createdAt,
            legacyOrderDetailId: d.id,
            // Loyalty points are earned prospectively from real deliveries
            // going forward (see packages/orders/src/loyalty-points.ts) —
            // deliberately left at the schema default (0) for backfilled
            // historical orders, never retroactively awarded.
          },
        });
      }

      const existingHistory = await tx.orderStatusHistory.findFirst({ where: { sellerOrderId: sellerOrder.id } });
      if (!existingHistory) {
        await tx.orderStatusHistory.create({
          data: {
            sellerOrderId: sellerOrder.id,
            status,
            actorId: "legacy-migration",
            actorRole: UserRole.ADMIN,
            source: "SYSTEM",
            note: "Imported from legacy site dealer order history.",
            createdAt: orderUpdatedAt,
          },
        });
      }
    });

    diagnostics.groupsWritten++;
    diagnostics.itemsWritten += resolvedLines.length;
  }

  console.log("\n" + "=".repeat(70));
  console.log(args.dryRun ? "SUMMARY (DRY RUN — nothing was written)" : "SUMMARY");
  console.log("=".repeat(70));
  console.log(`SellerOrder groups considered (all buyers): ${totalGroups}`);
  console.log(`  written/would-write (dealer-owned): ${diagnostics.groupsWritten}`);
  console.log(`  skipped, order header not found: ${diagnostics.skippedNoOrder}`);
  console.log(`  skipped, not a migrated dealer's order (expected — includes every real-customer order): ${diagnostics.skippedNoCustomer}`);
  console.log(`  skipped, zero lines resolved: ${diagnostics.skippedNoLinesResolved}`);
  console.log(`OrderItems written/would-write: ${diagnostics.itemsWritten}`);
  console.log(`Unresolved products (legacy product_id): ${diagnostics.unresolvedProducts.size}`);
  console.log(`Unresolved variants (legacy productId:variant): ${diagnostics.unresolvedVariants.size}`);
  console.log(`Unmapped order_status values: ${[...diagnostics.unmappedOrderStatuses].join(", ") || "(none)"}`);
  console.log(`Unmapped payment_method values: ${[...diagnostics.unmappedPaymentMethods].join(", ") || "(none)"}`);
  console.log(`Orders with no parseable shipping_address_data (fallback used): ${diagnostics.fallbackAddressCount}`);
  console.log(`Orders with no city in address (district fallback used): ${diagnostics.fallbackDistrictCount}`);
  console.log(`Unresolved state names: ${[...diagnostics.unresolvedStates].join(", ") || "(none)"}`);

  if (diagnostics.unresolvedProducts.size > 0) {
    console.log("\nSample unresolved products (first 20):");
    console.log("  " + [...diagnostics.unresolvedProducts].slice(0, 20).join(", "));
  }
  if (diagnostics.unresolvedVariants.size > 0) {
    console.log("\nSample unresolved variants (first 20):");
    console.log("  " + [...diagnostics.unresolvedVariants].slice(0, 20).join(", "));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
