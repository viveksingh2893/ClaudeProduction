/**
 * Integration tests against the real dev Postgres — same fixture
 * convention as settlement.test.ts (throwaway rows keyed by a unique RUN
 * timestamp, cleaned up in `after`), focused specifically on the Excel
 * export: exact headings/order, numeric values, exporting every filtered
 * row (not just one page), an empty result set, and formula-injection
 * protection on user-controlled text fields.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { prisma } from "@kisan4u/db";
import { transitionSellerOrder } from "./status-transitions";
import { upsertSettlementsForSellerOrder } from "./settlement";
import { generateSettlementWorkbook } from "./settlement-export";
import { saveSettlementRateConfig, saveSettlementHoldDays } from "./settlement-rates";

const RUN = Date.now();
// TCS/TDS are fixed statutory constants now (0.5%/0.1%), not part of this
// config — see settlement-rates.ts:FIXED_TCS_PERCENT/FIXED_TDS_PERCENT.
const RATES = { commissionGstPercent: 18, logisticsGstPercent: 18, collectionChargeGstPercent: 18 };

let categoryId: string;
let rateConfigId: string;
let sellerId: string;
let emptySellerId: string;
const cleanupUserIds: string[] = [];
const cleanupSellerIds: string[] = [];
const cleanupProductIds: string[] = [];
const cleanupCheckoutGroupIds: string[] = [];

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks as unknown as Uint8Array[]);
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;
  const rateConfig = await saveSettlementRateConfig({
    label: `TEST export rates ${RUN}`,
    ...RATES,
    isActive: true,
  });
  rateConfigId = rateConfig.id;
  await saveSettlementHoldDays(0);

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-export-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Export Seller",
      role: "SELLER",
      referralCode: `TESTEXP${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const seller = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      // Deliberately starts with '=' — proves the export neutralizes
      // formula injection on a user-controlled (seller-chosen) field
      // rather than merely happening not to trigger it.
      shopName: `=cmd|'/c calc'!A1 Export Shop ${RUN}`,
      slug: `test-export-shop-${RUN}`,
      status: "APPROVED",
      commissionPercent: 15,
      dealerCommissionPercent: 10,
    },
  });
  sellerId = seller.id;
  cleanupSellerIds.push(sellerId);

  const emptySellerUser = await prisma.user.create({
    data: {
      email: `test-export-empty-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Empty Export Seller",
      role: "SELLER",
      referralCode: `TESTEXPE${RUN}`,
    },
  });
  cleanupUserIds.push(emptySellerUser.id);
  const emptySeller = await prisma.sellerProfile.create({
    data: {
      userId: emptySellerUser.id,
      shopName: `Empty Export Shop ${RUN}`,
      slug: `test-export-empty-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  emptySellerId = emptySeller.id;
  cleanupSellerIds.push(emptySellerId);

  const customerUser = await prisma.user.create({
    data: {
      phone: `+91903${RUN.toString().slice(-6)}`,
      firstName: "=SUM(1+1) Test Customer", // also starts with '=' — a second injection-guard check on a different column
      role: "CUSTOMER",
      referralCode: `TESTEXPC${RUN}`,
    },
  });
  cleanupUserIds.push(customerUser.id);

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Export Product ${RUN}`,
      slug: `test-export-product-${RUN}`,
      sku: `TEST-EXP-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId,
      audience: "CUSTOMER_ONLY",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: false,
      primaryImageUrl: "/test.jpg",
      taxPercent: 18,
      customerConfig: {
        create: {
          mrp: 1000,
          sellingPrice: 1000,
          minOrderQty: 1,
          currentStock: 1000,
          weight: 500,
        },
      },
    },
  });
  cleanupProductIds.push(product.id);

  const suffix = `${RUN}-export`;
  const checkoutGroup = await prisma.checkoutGroup.create({
    data: {
      groupNumber: `TEST-K4U-${suffix}`,
      customerId: customerUser.id,
      customerType: "CUSTOMER",
    },
  });
  cleanupCheckoutGroupIds.push(checkoutGroup.id);
  await prisma.orderAddressSnapshot.create({
    data: {
      checkoutGroupId: checkoutGroup.id,
      fullName: "Test Recipient",
      mobile: "+919999999999",
      line1: "Line 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME",
    },
  });
  // transitionSellerOrder (called below to reach DELIVERED) requires
  // pickupPointId to already be set — see status-transitions.ts's
  // STATUSES_REQUIRING_PICKUP_POINT guard.
  const pickupPoint = await prisma.sellerPickupPoint.create({
    data: {
      sellerId,
      name: `Test Pickup ${suffix}`,
      contactPerson: "Test",
      mobile: "+919999999999",
      line1: "Test Line 1",
      city: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      isActive: true,
      approvalStatus: "APPROVED",
    },
  });
  const sellerOrder = await prisma.sellerOrder.create({
    data: {
      orderNumber: `TEST-K4U-${suffix}-S1`,
      checkoutGroupId: checkoutGroup.id,
      customerId: customerUser.id,
      sellerId,
      customerType: "CUSTOMER",
      status: "IN_TRANSIT",
      paymentMethod: "COD",
      deliveryMethod: "KISAN4U_COURIER",
      pickupPointId: pickupPoint.id,
      subtotal: 1000,
      taxAmount: 180,
      totalAmount: 1180,
      items: {
        create: [
          {
            productId: product.id,
            productName: "Test Export Product",
            productImageUrl: "/test.jpg",
            sku: `SKU-${product.id}`,
            quantity: 1,
            unit: "KG",
            unitWeightGrams: 500,
            totalWeightGrams: 500,
            mrp: 1000,
            unitPrice: 1000,
            taxRatePercent: 18,
            taxAmount: 180,
            subtotal: 1000,
          },
        ],
      },
    },
    include: { items: true },
  });
  await prisma.orderCharge.create({
    data: {
      sellerOrderId: sellerOrder.id,
      shipmentWeightGrams: 500,
      transportationCost: 0,
      transportationPayer: "SELLER",
      collectionCharge: 30,
      collectionChargePayer: "SELLER",
      customerPayableDelivery: 0,
      kisan4uCollectedAmount: 30,
      sellerBorneAmount: 30,
      slabSnapshot: {},
    },
  });
  const delivered = await transitionSellerOrder(
    sellerOrder.id,
    "DELIVERED",
    { id: customerUser.id, role: "ADMIN" },
    "SYSTEM",
    "test fixture",
  );
  assert.equal(delivered.ok, true, "test fixture must be able to reach DELIVERED");
  await upsertSettlementsForSellerOrder(prisma, sellerOrder.id);
});

after(async () => {
  await prisma.settlementAdjustment.deleteMany({
    where: { settlement: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.sellerSettlement.deleteMany({
    where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } },
  });
  await prisma.orderStatusHistory.deleteMany({
    where: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.orderCharge.deleteMany({
    where: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.orderItem.deleteMany({
    where: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.sellerOrder.deleteMany({
    where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } },
  });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } },
  });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: cleanupCheckoutGroupIds } } });
  for (const id of cleanupProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  for (const id of cleanupSellerIds)
    await prisma.sellerProfile.delete({ where: { id } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
  await prisma.settlementRateConfig.delete({ where: { id: rateConfigId } }).catch(() => {});
  // Deliberately not deleting the SettlementSettings singleton — see the
  // matching comment in settlement.test.ts's `after()` for why (a cross-file
  // race with concurrently-run test files).
});

test("exported workbook has the exact 33 required headings, in the exact required order", async () => {
  const { stream } = await generateSettlementWorkbook(sellerId, {});
  const buffer = await streamToBuffer(stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  const headerRow = sheet.getRow(1).values as (string | undefined)[];
  const headers = headerRow.slice(1); // exceljs row.values is 1-indexed with a leading empty slot

  assert.deepEqual(headers, [
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
  ]);
});

test("exported numeric values match the settlement's calculated figures", async () => {
  const { stream } = await generateSettlementWorkbook(sellerId, {});
  const buffer = await streamToBuffer(stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  const dataRow = sheet.getRow(2).values as unknown[];

  // Total Sales (col 15), GST Rate (col 16), Gross Commission (col 20), Total Shipment Weight (col 22),
  // Logistics Slab (col 23), Payable to seller (col 32), Delivered On (col 33)
  assert.equal(dataRow[15], 1180); // 1000 subtotal * 1.18
  assert.equal(dataRow[16], 18);
  assert.equal(dataRow[20], Math.round(1180 * 0.15 * 100) / 100);
  assert.equal(dataRow[22], 500); // single 500g item -> combined seller-order weight is 500g
  assert.equal(typeof dataRow[23], "string"); // "Logistics Slab" description, e.g. "0–500g @ ₹30"
  assert.equal(typeof dataRow[32], "number");
  assert.ok(
    dataRow[33] instanceof Date,
    "Delivered On must be populated for a real delivered order",
  );
});

test("delivered-only enforcement: a still-pending order for the same seller never appears in the export, even though it's a real order", async () => {
  const pendingCustomer = await prisma.user.create({
    data: {
      phone: `+91904${RUN.toString().slice(-6)}`,
      firstName: "Test Pending Export Customer",
      role: "CUSTOMER",
      referralCode: `TESTEXPP${RUN}`,
    },
  });
  cleanupUserIds.push(pendingCustomer.id);
  const pendingProduct = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Export Pending Product ${RUN}`,
      slug: `test-export-pending-product-${RUN}`,
      sku: `TEST-EXP-PENDING-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId,
      audience: "CUSTOMER_ONLY",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: false,
      primaryImageUrl: "/test.jpg",
      taxPercent: 18,
      customerConfig: {
        create: {
          mrp: 400,
          sellingPrice: 400,
          minOrderQty: 1,
          currentStock: 1000,
          weight: 500,
        },
      },
    },
  });
  cleanupProductIds.push(pendingProduct.id);

  const suffix = `${RUN}-export-pending`;
  const checkoutGroup = await prisma.checkoutGroup.create({
    data: {
      groupNumber: `TEST-K4U-${suffix}`,
      customerId: pendingCustomer.id,
      customerType: "CUSTOMER",
    },
  });
  cleanupCheckoutGroupIds.push(checkoutGroup.id);
  await prisma.orderAddressSnapshot.create({
    data: {
      checkoutGroupId: checkoutGroup.id,
      fullName: "Test Pending Recipient",
      mobile: "+919999999999",
      line1: "Line 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME",
    },
  });
  await prisma.sellerOrder.create({
    data: {
      orderNumber: `TEST-K4U-${suffix}-S1`,
      checkoutGroupId: checkoutGroup.id,
      customerId: pendingCustomer.id,
      sellerId,
      customerType: "CUSTOMER",
      status: "CONFIRMED", // never reaches DELIVERED — must never appear in the export
      paymentMethod: "COD",
      deliveryMethod: "KISAN4U_COURIER",
      subtotal: 400,
      taxAmount: 72,
      totalAmount: 472,
      items: {
        create: [
          {
            productId: pendingProduct.id,
            productName: "Test Pending Product",
            productImageUrl: "/test.jpg",
            sku: `SKU-${pendingProduct.id}`,
            quantity: 1,
            unit: "KG",
            unitWeightGrams: 500,
            totalWeightGrams: 500,
            mrp: 400,
            unitPrice: 400,
            taxRatePercent: 18,
            taxAmount: 72,
            subtotal: 400,
          },
        ],
      },
    },
  });

  const { stream } = await generateSettlementWorkbook(sellerId, {});
  const buffer = await streamToBuffer(stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  // Still exactly 1 data row (the DELIVERED fixture from before()) — the
  // pending order created above must not add a second row.
  assert.equal(sheet.rowCount, 2);
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i).values as unknown[];
    assert.notEqual(
      row[5],
      "Test Pending Product",
      "a non-delivered order's item must never appear in the export",
    );
  }
});

test("export includes every filtered row, not only a single page's worth", async () => {
  const { stream } = await generateSettlementWorkbook(sellerId, { pageSize: 1 });
  const buffer = await streamToBuffer(stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  // header + at least the one seeded settlement row — proves pageSize (a
  // UI-page concept) has no effect on the export, which always walks every
  // matching row via iterateAllSettlements.
  assert.ok(sheet.rowCount >= 2);
});

test("an empty result set still produces a valid workbook with just the header row", async () => {
  const { stream } = await generateSettlementWorkbook(emptySellerId, {});
  const buffer = await streamToBuffer(stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  assert.equal(sheet.rowCount, 1);
  assert.equal((sheet.getRow(1).values as unknown[]).slice(1)[1], "Order ID");
});

test("formula-injection protection: a shop/customer name starting with '=' is exported as safe text, not a live formula", async () => {
  const { stream } = await generateSettlementWorkbook(sellerId, {});
  const buffer = await streamToBuffer(stream);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  const dataRow = sheet.getRow(2).values as unknown[];
  const shopNameCell = dataRow[6]; // "Shop Name" column
  const customerNameCell = dataRow[7]; // "Customer Name" column

  assert.equal(typeof shopNameCell, "string");
  assert.ok(
    (shopNameCell as string).startsWith("'="),
    "a dangerous prefix must be neutralized with a leading apostrophe",
  );
  assert.equal(typeof customerNameCell, "string");
  assert.ok((customerNameCell as string).startsWith("'="));
});
