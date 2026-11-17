/**
 * Integration tests against the real dev Postgres — same convention as
 * phase4-security.test.ts/customer-checkout.test.ts: throwaway fixtures keyed
 * by a unique RUN timestamp, cleaned up in `after`. Most scenarios below
 * seed a SellerOrder directly through to DELIVERED (rather than driving the
 * full checkout()->accept->pack->pickup->transit->deliver chain each time,
 * which is already covered by customer-checkout.test.ts/dealer-delivery.test.ts)
 * so each test can precisely control the inputs that matter for settlement
 * math (negative payable, dealer vs customer commission, multi-seller,
 * historical rate changes). One end-to-end test drives the real
 * checkout()+order-workflow chain to prove the actual markDelivered() hook
 * creates settlements, not just the standalone service function.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, Prisma, type PaymentMethod, type PaymentStatus, type UserRole } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import {
  confirmOrder,
  acceptOrder,
  markPacked,
  schedulePickup,
  markPickedUp,
  markInTransit,
  markDelivered,
} from "./order-workflow";
import { transitionSellerOrder } from "./status-transitions";
import {
  upsertSettlementsForSellerOrder,
  reverseSettlement,
  markSettlementsSettled,
  listSettlements,
  getSettlement,
  listCommissionTableRows,
} from "./settlement";
import { saveSettlementRateConfig, saveSettlementHoldDays } from "./settlement-rates";
import { reconcileSellerSettlements } from "./settlement-reconciliation";
import { round2 } from "./money";

const RUN = Date.now();
// TCS/TDS are no longer part of this config — they're fixed statutory
// constants (0.5%/0.1%, see settlement-rates.ts:FIXED_TCS_PERCENT/FIXED_TDS_PERCENT),
// never admin-editable.
const RATES = {
  commissionGstPercent: 18,
  logisticsGstPercent: 18,
  collectionChargeGstPercent: 18,
};

// The demo seed (packages/db/prisma/seed.ts) always provisions one active
// LogisticsPricingConfig (0-500g -> Rs 30/unit) and one active
// CollectionChargeConfig (higher of Rs 30 flat or 1.5% of order net value) —
// both configs resolve to the OLDEST active row (unlike SettlementRateConfig,
// which resolves to the newest), so a test can't override them by creating a
// new one. Every fixture below uses a 500g unit weight specifically so its
// expected logistics charge is deterministic against that seeded slab.
const SEEDED_LOGISTICS_PRICE_FOR_500G = 30;
const SEEDED_COLLECTION_MIN_CHARGE = 30;
const SEEDED_COLLECTION_PERCENT = 1.5;

let categoryId: string;
let rateConfigId: string;
const cleanupUserIds: string[] = [];
const cleanupSellerIds: string[] = [];
const cleanupProductIds: string[] = [];
const cleanupCheckoutGroupIds: string[] = [];
const sellerUserIdOf: Record<string, string> = {};

async function makeSeller(
  label: string,
  commissionPercent: number,
  dealerCommissionPercent: number,
) {
  const user = await prisma.user.create({
    data: {
      email: `test-settlement-${label}-${RUN}@example.com`,
      firstName: `TEST FIXTURE Seller ${label}`,
      role: "SELLER",
      referralCode: `TESTSTL${label}${RUN}`,
    },
  });
  cleanupUserIds.push(user.id);
  const seller = await prisma.sellerProfile.create({
    data: {
      userId: user.id,
      shopName: `Test Settlement Shop ${label} ${RUN}`,
      slug: `test-settlement-shop-${label.toLowerCase()}-${RUN}`,
      status: "APPROVED",
      commissionPercent,
      dealerCommissionPercent,
    },
  });
  cleanupSellerIds.push(seller.id);
  sellerUserIdOf[seller.id] = user.id;
  return seller.id;
}

async function makeCustomer(label: string) {
  const user = await prisma.user.create({
    data: {
      phone: `+91902${RUN.toString().slice(-6)}${label}`,
      firstName: `TEST FIXTURE Customer ${label}`,
      role: "CUSTOMER",
      referralCode: `TESTSTC${label}${RUN}`,
    },
  });
  cleanupUserIds.push(user.id);
  return user.id;
}

async function makeProduct(
  sellerId: string,
  label: string,
  sellingPrice: number,
  taxPercent: number,
) {
  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Settlement Product ${label} ${RUN}`,
      slug: `test-settlement-product-${label.toLowerCase()}-${RUN}`,
      sku: `TEST-STL-${label}-${RUN}`,
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
      taxPercent,
      customerConfig: {
        // EXCLUDE_WITH_PRICE pinned explicitly — every assertion in this
        // file was written expecting tax added on top of sellingPrice
        // (e.g. totalSales = sellingPrice * (1 + taxPercent/100)); this
        // file is about settlement math, not the separate tax-inclusive-
        // price feature, so it keeps testing that regardless of
        // whichever mode is the schema's current default.
        create: {
          mrp: sellingPrice,
          sellingPrice,
          minOrderQty: 1,
          currentStock: 1000,
          weight: 500,
          taxCalcMode: "EXCLUDE_WITH_PRICE",
        },
      },
    },
  });
  cleanupProductIds.push(product.id);
  return product.id;
}

/**
 * Seeds a SellerOrder straight through to DELIVERED, bypassing the full
 * workflow chain, so each test can control exactly the financial inputs
 * that matter for settlement math without re-testing checkout/workflow
 * (already covered elsewhere).
 */
async function seedDeliveredSellerOrder(opts: {
  sellerId: string;
  customerId: string;
  customerType: UserRole;
  items: {
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    taxRatePercent: number;
    /** Defaults to 500g, matching every other fixture in this file — override per item for the order-level logistics-allocation tests below. */
    unitWeightGrams?: number;
  }[];
  // OrderCharge.transportationCost/collectionCharge are no longer read by
  // settlement calculation (that now comes from the item's own
  // unitWeightGrams against LogisticsPricingConfig, and from
  // CollectionChargeConfig against the order's total net value — see
  // settlement.ts) — these two params only shape the OrderCharge row
  // itself, which is still created for a realistic fixture shape.
  transportationCost?: number;
  transportationPayer?: "SELLER" | "CUSTOMER";
  collectionCharge?: number;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  shippingState?: string;
}) {
  const suffix = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const checkoutGroup = await prisma.checkoutGroup.create({
    data: {
      groupNumber: `TEST-K4U-${suffix}`,
      customerId: opts.customerId,
      customerType: opts.customerType,
    },
  });
  cleanupCheckoutGroupIds.push(checkoutGroup.id);
  await prisma.orderAddressSnapshot.create({
    data: {
      checkoutGroupId: checkoutGroup.id,
      fullName: "Test Recipient",
      mobile: "+919999999999",
      line1: "Test Line 1",
      cityTown: "Testville",
      district: "Test District",
      state: opts.shippingState ?? "Maharashtra",
      pincode: "411001",
      addressType: "HOME",
    },
  });

  const itemsWithTotals = opts.items.map((item) => ({
    ...item,
    subtotal: Math.round(item.unitPrice * item.quantity * 100) / 100,
    taxAmount:
      Math.round(((item.unitPrice * item.quantity * item.taxRatePercent) / 100) * 100) / 100,
  }));
  const subtotal = itemsWithTotals.reduce((sum, i) => sum + i.subtotal, 0);
  const taxAmount = itemsWithTotals.reduce((sum, i) => sum + i.taxAmount, 0);

  // transitionSellerOrder (called below to reach DELIVERED) requires
  // pickupPointId to already be set for any status from SELLER_ACCEPTED
  // onward — see status-transitions.ts's STATUSES_REQUIRING_PICKUP_POINT
  // guard — so this raw-created fixture needs one too, even though it
  // skips the real accept/pack/schedule flow entirely.
  const pickupPoint = await prisma.sellerPickupPoint.create({
    data: {
      sellerId: opts.sellerId,
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
      customerId: opts.customerId,
      sellerId: opts.sellerId,
      customerType: opts.customerType,
      status: "IN_TRANSIT", // one step before DELIVERED — transitioned below via the real service
      paymentMethod: opts.paymentMethod ?? "COD",
      deliveryMethod: "KISAN4U_COURIER",
      pickupPointId: pickupPoint.id,
      subtotal,
      taxAmount,
      totalAmount: subtotal + taxAmount,
      items: {
        create: itemsWithTotals.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          productImageUrl: "/test.jpg",
          sku: `SKU-${item.productId}`,
          quantity: item.quantity,
          unit: "KG",
          unitWeightGrams: item.unitWeightGrams ?? 500,
          totalWeightGrams: (item.unitWeightGrams ?? 500) * item.quantity,
          mrp: item.unitPrice,
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          taxAmount: item.taxAmount,
          subtotal: item.subtotal,
        })),
      },
    },
    include: { items: true },
  });

  const transportationCost = opts.transportationCost ?? 0;
  const transportationPayer = opts.transportationPayer ?? "SELLER";
  const collectionCharge = opts.collectionCharge ?? 0;
  await prisma.orderCharge.create({
    data: {
      sellerOrderId: sellerOrder.id,
      shipmentWeightGrams: 500,
      transportationCost,
      transportationPayer,
      collectionCharge,
      collectionChargePayer: "SELLER",
      customerPayableDelivery: transportationPayer === "CUSTOMER" ? transportationCost : 0,
      kisan4uCollectedAmount: transportationCost + collectionCharge,
      sellerBorneAmount:
        (transportationPayer === "SELLER" ? transportationCost : 0) + collectionCharge,
      slabSnapshot: {},
    },
  });

  const payment = await prisma.payment.create({
    data: {
      checkoutGroupId: checkoutGroup.id,
      customerId: opts.customerId,
      method: opts.paymentMethod ?? "COD",
      status: opts.paymentStatus ?? "PAID",
      totalAmount: subtotal + taxAmount,
      amountPaid: subtotal + taxAmount,
      internalReference: `TEST-PAY-${suffix}`,
    },
  });
  await prisma.paymentAllocation.create({
    data: { paymentId: payment.id, sellerOrderId: sellerOrder.id, amount: subtotal + taxAmount },
  });

  const transition = await transitionSellerOrder(
    sellerOrder.id,
    "DELIVERED",
    { id: opts.customerId, role: "ADMIN" },
    "SYSTEM",
    "test fixture delivery",
  );
  assert.equal(transition.ok, true, "test fixture must be able to reach DELIVERED");

  return {
    sellerOrderId: sellerOrder.id,
    itemIds: sellerOrder.items.map((i) => i.id),
    checkoutGroupId: checkoutGroup.id,
  };
}

/**
 * A single-item SellerOrder left at CONFIRMED (never transitioned to
 * DELIVERED) — the fixture for "an order visible on /seller/orders that has
 * no settlement row yet." Deliberately minimal (no Payment/OrderCharge) —
 * listCommissionTableRows tolerates their absence (financial status falls
 * back to PENDING, no logistics/collection math runs since there's no
 * settlement to calculate yet).
 */
async function seedNonDeliveredOrder(opts: {
  sellerId: string;
  customerId: string;
  productId: string;
  unitPrice: number;
  taxRatePercent: number;
}) {
  const suffix = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const checkoutGroup = await prisma.checkoutGroup.create({
    data: {
      groupNumber: `TEST-K4U-${suffix}`,
      customerId: opts.customerId,
      customerType: "CUSTOMER",
    },
  });
  cleanupCheckoutGroupIds.push(checkoutGroup.id);
  await prisma.orderAddressSnapshot.create({
    data: {
      checkoutGroupId: checkoutGroup.id,
      fullName: "Test Recipient",
      mobile: "+919999999999",
      line1: "Test Line 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME",
    },
  });
  const subtotal = opts.unitPrice;
  const taxAmount = Math.round(((opts.unitPrice * opts.taxRatePercent) / 100) * 100) / 100;
  const sellerOrder = await prisma.sellerOrder.create({
    data: {
      orderNumber: `TEST-K4U-${suffix}-S1`,
      checkoutGroupId: checkoutGroup.id,
      customerId: opts.customerId,
      sellerId: opts.sellerId,
      customerType: "CUSTOMER",
      status: "CONFIRMED",
      paymentMethod: "COD",
      deliveryMethod: "KISAN4U_COURIER",
      subtotal,
      taxAmount,
      totalAmount: subtotal + taxAmount,
      items: {
        create: [
          {
            productId: opts.productId,
            productName: "Test Pending Product",
            productImageUrl: "/test.jpg",
            sku: `SKU-${opts.productId}`,
            quantity: 1,
            unit: "KG",
            unitWeightGrams: 500,
            totalWeightGrams: 500,
            mrp: opts.unitPrice,
            unitPrice: opts.unitPrice,
            taxRatePercent: opts.taxRatePercent,
            taxAmount,
            subtotal,
          },
        ],
      },
    },
    include: { items: true },
  });

  return {
    sellerOrderId: sellerOrder.id,
    itemId: sellerOrder.items[0]!.id,
    checkoutGroupId: checkoutGroup.id,
  };
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;
  const rateConfig = await saveSettlementRateConfig({
    label: `TEST global rates ${RUN}`,
    ...RATES,
    isActive: true,
  });
  rateConfigId = rateConfig.id;
  await saveSettlementHoldDays(0); // immediate eligibility — tests don't want to wait on a hold period
});

after(async () => {
  await prisma.settlementAdjustment.deleteMany({
    where: { settlement: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.sellerSettlement.deleteMany({
    where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } },
  });
  await prisma.paymentAllocation.deleteMany({
    where: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.payment.deleteMany({ where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } });
  await prisma.orderStatusHistory.deleteMany({
    where: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.shipmentStatusHistory.deleteMany({
    where: { shipment: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } } },
  });
  await prisma.shipment.deleteMany({
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
  await prisma.cartItem.deleteMany({ where: { productId: { in: cleanupProductIds } } });
  for (const id of cleanupProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerPickupPoint.deleteMany({ where: { sellerId: { in: cleanupSellerIds } } });
  for (const id of cleanupSellerIds)
    await prisma.sellerProfile.delete({ where: { id } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
  await prisma.settlementRateConfig.delete({ where: { id: rateConfigId } }).catch(() => {});
  // Deliberately NOT deleting the SettlementSettings singleton here: this
  // file and settlement-export.test.ts both touch it, and node:test runs
  // separate test files as concurrent processes — one file's cleanup
  // deleting the row while the other is mid-test (still relying on
  // holdDays=0) causes a real, observed flaky failure (resolveSettlementHoldDays
  // falling back to the default of 7 mid-run). Leaving it at holdDays=0 is
  // harmless — both files set it to 0 in their own `before()` anyway, and
  // `pnpm --filter @kisan4u/db seed` always resets it back to the demo
  // default of 7 afterward.
});

test("idempotent creation + duplicate-event retry: re-running the same delivery event never duplicates or re-charges", async () => {
  const sellerId = await makeSeller("Idem", 15, 10);
  const customerId = await makeCustomer("Idem");
  const productId = await makeProduct(sellerId, "Idem", 3957.63, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    // unitPrice is tax-exclusive (matches checkout.ts's convention — tax is
    // added on top of sellingPrice, never extracted from an inclusive
    // price), so this reproduces the golden example's Rs 4670 Total Sales
    // (inc. tax) exactly: 3957.63 * 1.18 = 4670.0034 -> rounds to 4670.00.
    items: [
      {
        productId,
        productName: "Test Product",
        unitPrice: 3957.63,
        quantity: 1,
        taxRatePercent: 18,
      },
    ],
  });

  // Expected payable, computed by hand against the corrected formula: gross
  // commission 700.50 (15% of 4670), commission tax 126.09 (18%); base
  // logistics 30.00 (the seeded 500g slab) x qty 1, logistics tax 5.40
  // (18%); collection charge = higher of Rs 30 flat or 1.5% of 4670 =
  // 70.05, collection tax 12.61 (18%); TCS 19.79 (0.5% of taxable value
  // 3957.63), TDS 4.67 (0.1% of 4670). 4670 - 700.50 - 126.09 - 30 - 5.40 -
  // 70.05 - 12.61 - 19.79 - 4.67 = 3700.89.
  const EXPECTED_PAYABLE = 3700.89;

  const first = await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  assert.equal(first.ok, true);
  const afterFirst = await prisma.sellerSettlement.findMany({
    where: { orderItemId: { in: itemIds } },
  });
  assert.equal(afterFirst.length, 1);
  assert.equal(Number(afterFirst[0]!.logisticSellerBorne), SEEDED_LOGISTICS_PRICE_FOR_500G);
  assert.equal(Number(afterFirst[0]!.collectionCharge), 70.05);
  assert.equal(Number(afterFirst[0]!.payableToSeller), EXPECTED_PAYABLE);

  const second = await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  assert.equal(second.ok, true);
  const afterSecond = await prisma.sellerSettlement.findMany({
    where: { orderItemId: { in: itemIds } },
  });
  assert.equal(afterSecond.length, 1, "retrying the same event must not create a duplicate row");
  assert.equal(afterSecond[0]!.id, afterFirst[0]!.id);
  assert.equal(Number(afterSecond[0]!.payableToSeller), EXPECTED_PAYABLE);
});

test("a unique constraint prevents two settlement rows for the same order item even if inserted directly", async () => {
  const sellerId = await makeSeller("Unique", 15, 10);
  const customerId = await makeCustomer("Unique");
  const productId = await makeProduct(sellerId, "Unique", 1000, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 1000, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const existing = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  await assert.rejects(
    prisma.sellerSettlement.create({
      data: {
        ...cloneForInsert(existing),
        logisticsSlabSnapshot: existing.logisticsSlabSnapshot ?? Prisma.JsonNull,
      },
    }),
  );
});

function cloneForInsert(row: Awaited<ReturnType<typeof prisma.sellerSettlement.findFirstOrThrow>>) {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    logisticsSlabSnapshot: _slab,
    ...rest
  } = row;
  return rest;
}

test("dealer vs customer: the same seller applies dealerCommissionPercent to a DEALER order and commissionPercent to a CUSTOMER order", async () => {
  const sellerId = await makeSeller("DealerVsCustomer", 15, 25);
  const customer = await makeCustomer("DVCcust");
  const dealerUser = await makeCustomer("DVCdealer"); // role doesn't matter for this direct-seed test — customerType drives the branch
  const productId = await makeProduct(sellerId, "DVC", 1000, 18);

  const customerOrder = await seedDeliveredSellerOrder({
    sellerId,
    customerId: customer,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 1000, quantity: 1, taxRatePercent: 18 },
    ],
  });
  const dealerOrder = await seedDeliveredSellerOrder({
    sellerId,
    customerId: dealerUser,
    customerType: "DEALER",
    items: [
      { productId, productName: "Test Product", unitPrice: 1000, quantity: 1, taxRatePercent: 18 },
    ],
  });

  await upsertSettlementsForSellerOrder(prisma, customerOrder.sellerOrderId);
  await upsertSettlementsForSellerOrder(prisma, dealerOrder.sellerOrderId);

  const customerSettlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: customerOrder.itemIds[0] },
  });
  const dealerSettlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: dealerOrder.itemIds[0] },
  });

  assert.equal(Number(customerSettlement.commissionValuePercent), 15);
  assert.equal(Number(dealerSettlement.commissionValuePercent), 25);
  assert.notEqual(
    Number(customerSettlement.grossCommission),
    Number(dealerSettlement.grossCommission),
  );
});

test("historical-rate snapshot: changing the global rate config (or the fixed TCS/TDS constants) after a settlement is created never changes that settlement's snapshotted rates", async () => {
  const sellerId = await makeSeller("Historical", 15, 10);
  const customerId = await makeCustomer("Historical");
  const productId = await makeProduct(sellerId, "Historical", 1000, 18);
  const { itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 1000, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(
    prisma,
    (await prisma.orderItem.findFirstOrThrow({ where: { id: itemIds[0] } })).sellerOrderId,
  );
  const before = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  assert.equal(Number(before.commissionGstRatePercent), 18);
  assert.equal(Number(before.tcsRatePercent), 0.5);
  assert.equal(Number(before.tdsRatePercent), 0.1);

  const newConfig = await saveSettlementRateConfig({
    label: `TEST changed rates ${RUN}`,
    ...RATES,
    commissionGstPercent: 99,
    isActive: true,
  });
  try {
    const after_ = await prisma.sellerSettlement.findFirstOrThrow({
      where: { orderItemId: itemIds[0] },
    });
    assert.equal(
      Number(after_.commissionGstRatePercent),
      18,
      "an existing settlement's snapshotted rate must not change when the config changes later",
    );
    assert.equal(
      Number(after_.grossCommissionTax),
      Number(before.grossCommissionTax),
      "the calculated tax amount itself must also stay frozen",
    );
  } finally {
    await prisma.settlementRateConfig.delete({ where: { id: newConfig.id } });
  }
});

test("negative payable is flagged NEEDS_REVIEW, never silently clamped to zero", async () => {
  const sellerId = await makeSeller("Negative", 90, 90); // deliberately extreme commission to force a negative payable
  const customerId = await makeCustomer("Negative");
  const productId = await makeProduct(sellerId, "Negative", 100, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 100, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  assert.ok(Number(settlement.payableToSeller) < 0);
  assert.equal(settlement.status, "NEEDS_REVIEW");
});

test("a settled record is reversed via an append-only adjustment, never overwritten", async () => {
  const sellerId = await makeSeller("Reversal", 15, 10);
  const customerId = await makeCustomer("Reversal");
  const productId = await makeProduct(sellerId, "Reversal", 1000, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 1000, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  await prisma.sellerSettlement.updateMany({
    where: { orderItemId: itemIds[0] },
    data: { status: "ELIGIBLE" },
  });
  const settlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });

  const settleResult = await markSettlementsSettled([settlement.id], {
    id: "test-admin",
    role: "ADMIN",
  });
  assert.equal(settleResult.count, 1);
  const settled = await prisma.sellerSettlement.findFirstOrThrow({ where: { id: settlement.id } });
  assert.equal(settled.status, "SETTLED");
  assert.ok(settled.settledAt);

  const originalPayable = Number(settled.payableToSeller);
  const reversal = await reverseSettlement({
    settlementId: settlement.id,
    reason: "RETURN",
    actor: { id: "test-admin", role: "ADMIN" },
    note: "test full return",
  });
  assert.equal(reversal.ok, true);
  if (reversal.ok) assert.equal(reversal.netPayable, 0);

  const afterReversal = await prisma.sellerSettlement.findFirstOrThrow({
    where: { id: settlement.id },
    include: { adjustments: true },
  });
  assert.equal(afterReversal.status, "REVERSED");
  assert.equal(
    Number(afterReversal.payableToSeller),
    originalPayable,
    "the original calculated payable is never overwritten",
  );
  assert.equal(afterReversal.adjustments.length, 1);
  assert.equal(Number(afterReversal.adjustments[0]!.amount), -originalPayable);
  assert.equal(afterReversal.adjustments[0]!.reason, "RETURN");
});

test("cancellation before delivery: no settlement row is ever created", async () => {
  const sellerId = await makeSeller("Cancel", 15, 10);
  const customerId = await makeCustomer("Cancel");
  const productId = await makeProduct(sellerId, "Cancel", 1000, 18);
  await addToCart(
    customerId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      newAddress: {
        fullName: "Test Cancel",
        mobile: "+919999999999",
        altMobile: undefined,
        line1: "Line 1",
        cityTown: "Testville",
        district: "Test District",
        state: "Maharashtra",
        pincode: "411001",
        addressType: "HOME",
        isDefault: false,
      },
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-settlement-cancel-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanupCheckoutGroupIds.push(result.checkoutGroupId);
  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });

  const cancelled = await transitionSellerOrder(
    order.id,
    "CANCELLED",
    { id: "test-admin", role: "ADMIN" },
    "ADMIN",
    "test cancel",
  );
  assert.equal(cancelled.ok, true);

  const attempt = await upsertSettlementsForSellerOrder(prisma, order.id);
  assert.equal(attempt.ok, true);
  if (attempt.ok) assert.equal(attempt.created, 0);
  const settlements = await prisma.sellerSettlement.findMany({
    where: { sellerOrderId: order.id },
  });
  assert.equal(settlements.length, 0);
});

test("multi-seller order: each seller gets independent settlement rows, scoped to their own items only", async () => {
  const sellerA = await makeSeller("MultiA", 10, 10);
  const sellerB = await makeSeller("MultiB", 20, 20);
  const customerId = await makeCustomer("Multi");
  const productA = await makeProduct(sellerA, "MultiA", 500, 18);
  const productB = await makeProduct(sellerB, "MultiB", 800, 18);

  const groupSuffix = `${RUN}-multi`;
  const checkoutGroup = await prisma.checkoutGroup.create({
    data: { groupNumber: `TEST-K4U-${groupSuffix}`, customerId, customerType: "CUSTOMER" },
  });
  cleanupCheckoutGroupIds.push(checkoutGroup.id);
  await prisma.orderAddressSnapshot.create({
    data: {
      checkoutGroupId: checkoutGroup.id,
      fullName: "Test Multi",
      mobile: "+919999999999",
      line1: "Line 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME",
    },
  });

  async function createSellerOrderIn(
    sellerId: string,
    productId: string,
    unitPrice: number,
    suffix: string,
  ) {
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
    const order = await prisma.sellerOrder.create({
      data: {
        orderNumber: `TEST-K4U-${groupSuffix}-${suffix}`,
        checkoutGroupId: checkoutGroup.id,
        customerId,
        sellerId,
        customerType: "CUSTOMER",
        status: "IN_TRANSIT",
        paymentMethod: "COD",
        deliveryMethod: "KISAN4U_COURIER",
        pickupPointId: pickupPoint.id,
        subtotal: unitPrice,
        taxAmount: round2(unitPrice * 0.18),
        totalAmount: round2(unitPrice * 1.18),
        items: {
          create: [
            {
              productId,
              productName: "Test Multi Product",
              productImageUrl: "/test.jpg",
              sku: `SKU-${productId}`,
              quantity: 1,
              unit: "KG",
              unitWeightGrams: 500,
              totalWeightGrams: 500,
              mrp: unitPrice,
              unitPrice,
              taxRatePercent: 18,
              taxAmount: round2(unitPrice * 0.18),
              subtotal: unitPrice,
            },
          ],
        },
      },
      include: { items: true },
    });
    await prisma.orderCharge.create({
      data: {
        sellerOrderId: order.id,
        shipmentWeightGrams: 500,
        transportationCost: 0,
        transportationPayer: "SELLER",
        collectionCharge: 0,
        collectionChargePayer: "SELLER",
        customerPayableDelivery: 0,
        kisan4uCollectedAmount: 0,
        sellerBorneAmount: 0,
        slabSnapshot: {},
      },
    });
    const delivered = await transitionSellerOrder(
      order.id,
      "DELIVERED",
      { id: customerId, role: "ADMIN" },
      "SYSTEM",
      "test fixture",
    );
    assert.equal(delivered.ok, true, "test fixture must be able to reach DELIVERED");
    return order;
  }
  function round2(v: number) {
    return Math.round(v * 100) / 100;
  }

  const orderA = await createSellerOrderIn(sellerA, productA, 500, "S1");
  const orderB = await createSellerOrderIn(sellerB, productB, 800, "S2");

  await upsertSettlementsForSellerOrder(prisma, orderA.id);
  await upsertSettlementsForSellerOrder(prisma, orderB.id);

  const settlementsA = await listSettlements(sellerA);
  const settlementsB = await listSettlements(sellerB);

  assert.equal(settlementsA.rows.length, 1);
  assert.equal(settlementsB.rows.length, 1);
  assert.equal(settlementsA.rows[0]!.sellerId, sellerA);
  assert.equal(settlementsB.rows[0]!.sellerId, sellerB);
  assert.notEqual(settlementsA.rows[0]!.id, settlementsB.rows[0]!.id);
});

test("seller isolation: a seller cannot read another seller's settlement, even by direct id", async () => {
  const sellerA = await makeSeller("IsoA", 10, 10);
  const sellerB = await makeSeller("IsoB", 10, 10);
  const customerId = await makeCustomer("Iso");
  const productA = await makeProduct(sellerA, "IsoA", 500, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId: sellerA,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productA,
        productName: "Test Product",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 18,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });

  const asOwner = await getSettlement(sellerA, settlement.id);
  const asOtherSeller = await getSettlement(sellerB, settlement.id);
  assert.ok(asOwner);
  assert.equal(
    asOtherSeller,
    null,
    "a settlement must never be readable through another seller's id",
  );

  const listForB = await listSettlements(sellerB);
  assert.equal(
    listForB.rows.some((r) => r.id === settlement.id),
    false,
  );
});

test("full end-to-end: the real checkout() + markDelivered() workflow chain creates a settlement automatically", async () => {
  const sellerId = await makeSeller("E2E", 15, 10);
  const customerId = await makeCustomer("E2E");
  const productId = await makeProduct(sellerId, "E2E", 2000, 18);

  const pickupPoint = await prisma.sellerPickupPoint.create({
    data: {
      sellerId,
      name: "Test Pickup",
      contactPerson: "Test",
      mobile: "+919999999999",
      line1: "Line 1",
      city: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      isActive: true,
      approvalStatus: "APPROVED",
    },
  });

  await addToCart(
    customerId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      newAddress: {
        fullName: "Test E2E",
        mobile: "+919999999999",
        altMobile: undefined,
        line1: "Line 1",
        cityTown: "Testville",
        district: "Test District",
        state: "Maharashtra",
        pincode: "411001",
        addressType: "HOME",
        isDefault: false,
      },
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-settlement-e2e-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanupCheckoutGroupIds.push(result.checkoutGroupId);
  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  const sellerUserId = sellerUserIdOf[sellerId]!;

  // Orders are placed as "Pending" — confirm before the seller can act.
  assert.equal((await confirmOrder(sellerUserId, order.id)).ok, true);
  await acceptOrder(sellerId, sellerUserId, {
    sellerOrderId: order.id,
    pickupPointId: pickupPoint.id,
  });
  await markPacked(sellerId, sellerUserId, { sellerOrderId: order.id });
  await schedulePickup(sellerId, sellerUserId, { sellerOrderId: order.id });
  await markPickedUp(sellerId, sellerUserId, order.id);
  await markInTransit(sellerId, sellerUserId, order.id);
  const delivered = await markDelivered(sellerId, sellerUserId, order.id);
  assert.equal(delivered.ok, true);

  const settlements = await prisma.sellerSettlement.findMany({
    where: { sellerOrderId: order.id },
  });
  assert.equal(
    settlements.length,
    1,
    "markDelivered must create exactly one settlement row for this single-item order",
  );
  assert.equal(Number(settlements[0]!.totalSales), 2360); // 2000 * 1.18
  assert.equal(settlements[0]!.status, "ELIGIBLE"); // holdDays=0 in this test suite
  assert.ok(
    settlements[0]!.deliveredAt,
    "the real markDelivered() workflow hook must capture a delivery timestamp",
  );
});

// ---------------------------------------------------------------------------
// Corrected-formula scenarios (settlement-correction task requirements 2, 6,
// 7, 8, 11, 12, 15, 16, 17, 18 — TCS/TDS and the golden-row payable are
// covered at the calculator level in settlement-calculator.test.ts).
// ---------------------------------------------------------------------------

test("different products in the same order have independently correct GST rates", async () => {
  const sellerId = await makeSeller("MultiGst", 10, 10);
  const customerId = await makeCustomer("MultiGst");
  const productA = await makeProduct(sellerId, "MultiGstA", 1000, 18);
  const productB = await makeProduct(sellerId, "MultiGstB", 500, 5);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productA,
        productName: "Item A",
        unitPrice: 1000,
        quantity: 1,
        taxRatePercent: 18,
      },
      {
        productId: productB,
        productName: "Item B",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 5,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlementA = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  const settlementB = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[1] },
  });

  assert.equal(Number(settlementA.gstRatePercent), 18);
  assert.equal(Number(settlementA.totalSales), 1180); // 1000 * 1.18
  assert.equal(Number(settlementB.gstRatePercent), 5);
  assert.equal(Number(settlementB.totalSales), 525); // 500 * 1.05
});

test("collection charge uses the flat minimum when the percentage would be lower", async () => {
  const sellerId = await makeSeller("CollectionMin", 10, 10);
  const customerId = await makeCustomer("CollectionMin");
  const productId = await makeProduct(sellerId, "CollectionMin", 100, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    // Total net value 118 -> 1.5% = 1.77, well under the Rs 30 flat minimum.
    items: [
      { productId, productName: "Test Product", unitPrice: 100, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  assert.equal(Number(settlement.collectionCharge), SEEDED_COLLECTION_MIN_CHARGE);
});

test("collection charge uses the percentage when it's higher than the flat minimum", async () => {
  const sellerId = await makeSeller("CollectionPct", 10, 10);
  const customerId = await makeCustomer("CollectionPct");
  const productId = await makeProduct(sellerId, "CollectionPct", 5000, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    // Total net value 5900 -> 1.5% = 88.50, above the Rs 30 flat minimum.
    items: [
      { productId, productName: "Test Product", unitPrice: 5000, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  assert.equal(
    Number(settlement.collectionCharge),
    round2(5900 * (SEEDED_COLLECTION_PERCENT / 100)),
  );
});

// ---------------------------------------------------------------------------
// Order-level allocation (settlement order-level allocation task): logistics
// and collection charge are each calculated ONCE per seller order (combined
// weight -> one slab; combined net value -> one charge), then allocated
// proportionally back across that seller order's line items. Replaces the
// old "product-wise" (v3) tests above with v4 order-level equivalents —
// see SETTLEMENT_CALCULATION_VERSION's changelog in settlement.ts.
// ---------------------------------------------------------------------------

test("collection charge is calculated once per seller order and allocated by net-value share — never duplicated per item or per quantity", async () => {
  const sellerId = await makeSeller("CollectionOrderLevel", 10, 10);
  const customerId = await makeCustomer("CollectionOrderLevel");
  const productA = await makeProduct(sellerId, "CollOrdA", 500, 0);
  const productB = await makeProduct(sellerId, "CollOrdB", 100, 0);
  // 0% tax so "unit price" IS the net value, matching the task's worked example exactly.
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productA,
        productName: "Item A",
        unitPrice: 500,
        quantity: 2,
        taxRatePercent: 0,
      },
      {
        productId: productB,
        productName: "Item B",
        unitPrice: 100,
        quantity: 1,
        taxRatePercent: 0,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlementA = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  const settlementB = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[1] },
  });

  // Combined net value: (500*2) + (100*1) = 1100 -> 1.5% = 16.50, below the
  // Rs 30 flat minimum -> Rs 30 charged ONCE for the whole seller order
  // (never per item, never per quantity).
  assert.equal(Number(settlementA.sellerOrderTotalNetValue), 1100);
  assert.equal(Number(settlementA.sellerOrderCollectionCharge), 30);
  assert.equal(
    Number(settlementB.sellerOrderCollectionCharge),
    30,
    "the shared order-level total must be identical on every line",
  );

  // Allocated by net-value share — A's row already represents quantity 2
  // (line value 1000), shown once, never doubled: 30 x 1000/1100 = 27.27.
  assert.equal(Number(settlementA.collectionCharge), 27.27);
  assert.equal(Number(settlementB.collectionCharge), 2.73);
  assert.notEqual(
    Number(settlementA.collectionCharge),
    round2((1000 / 1100) * 30 * 2),
    "must not multiply the value-share allocation by quantity again — quantity is already inside the 1000 line value",
  );

  // Reconciles exactly to the seller-order total — no rounding drift.
  assert.equal(
    round2(Number(settlementA.collectionCharge) + Number(settlementB.collectionCharge)),
    30,
  );

  // Collection-charge tax allocations reconcile exactly too.
  assert.equal(
    round2(Number(settlementA.collectionChargeTax) + Number(settlementB.collectionChargeTax)),
    Number(settlementA.sellerOrderCollectionTax),
  );
});

test("logistics is calculated once per seller order from the COMBINED weight (one slab lookup), never per item and never charged per unit", async () => {
  const sellerId = await makeSeller("LogisticsOrderLevel", 10, 10);
  const customerId = await makeCustomer("LogisticsOrderLevel");
  const productA = await makeProduct(sellerId, "LogOrdA", 1000, 0);
  const productB = await makeProduct(sellerId, "LogOrdB", 1000, 0);
  // 300g x2 + 500g x1 = 1100g combined -> the seeded demo config's 501-2000g
  // slab (Rs 60), never the 0-500g slab a per-item 300g/500g lookup would
  // each independently match, and never 2x/3x that slab price either.
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productA,
        productName: "Item A",
        unitPrice: 1000,
        quantity: 2,
        taxRatePercent: 0,
        unitWeightGrams: 300,
      },
      {
        productId: productB,
        productName: "Item B",
        unitPrice: 1000,
        quantity: 1,
        taxRatePercent: 0,
        unitWeightGrams: 500,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlementA = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  const settlementB = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[1] },
  });

  assert.equal(settlementA.lineWeightGrams, 600); // 300g x 2
  assert.equal(settlementB.lineWeightGrams, 500); // 500g x 1
  assert.equal(settlementA.sellerOrderTotalWeightGrams, 1100);
  assert.equal(
    settlementB.sellerOrderTotalWeightGrams,
    1100,
    "the shared combined weight must be identical on every line",
  );
  assert.equal(
    Number(settlementA.sellerOrderLogisticsCharge),
    60,
    "one slab charge for the combined 1100g, matched exactly once",
  );
  assert.equal(Number(settlementB.sellerOrderLogisticsCharge), 60);
  assert.ok(
    settlementA.logisticsSlabSnapshot,
    "the matched slab must be snapshotted for audit/export",
  );

  // Allocated by weight share: A gets 600/1100, B gets 500/1100 of Rs 60.
  assert.equal(Number(settlementA.logisticSellerBorne), round2((60 * 600) / 1100));
  assert.equal(Number(settlementB.logisticSellerBorne), round2((60 * 500) / 1100));
  // Reconciles exactly — no leftover paisa.
  assert.equal(
    round2(Number(settlementA.logisticSellerBorne) + Number(settlementB.logisticSellerBorne)),
    60,
  );

  // Logistics-tax allocations also reconcile exactly to the order-level tax.
  assert.equal(
    round2(Number(settlementA.logisticTax) + Number(settlementB.logisticTax)),
    Number(settlementA.sellerOrderLogisticsTax),
  );

  // Never the old per-item behavior: 300g's own slab (Rs 30) x qty 2 = Rs 60
  // would coincidentally equal the correct total here, so assert against the
  // per-item-times-quantity value on the OTHER item instead — 500g's own
  // slab is also Rs 30, so a per-item calculation would have charged
  // Rs 30 on item B alone, not its 500/1100 share of a combined Rs 60.
  assert.notEqual(Number(settlementB.logisticSellerBorne), 30);
});

test("logistics/collection allocation is computed independently per seller within a multi-seller checkout — never pooled across sellers", async () => {
  const sellerA = await makeSeller("LogMultiA", 10, 10);
  const sellerB = await makeSeller("LogMultiB", 10, 10);
  const customerId = await makeCustomer("LogMulti");
  const productA = await makeProduct(sellerA, "LogMultiPA", 500, 0);
  const productB = await makeProduct(sellerB, "LogMultiPB", 500, 0);

  const orderA = await seedDeliveredSellerOrder({
    sellerId: sellerA,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productA,
        productName: "A",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 0,
        unitWeightGrams: 2500,
      },
    ],
  });
  const orderB = await seedDeliveredSellerOrder({
    sellerId: sellerB,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productB,
        productName: "B",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 0,
        unitWeightGrams: 300,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, orderA.sellerOrderId);
  await upsertSettlementsForSellerOrder(prisma, orderB.sellerOrderId);

  const settlementA = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: orderA.itemIds[0] },
  });
  const settlementB = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: orderB.itemIds[0] },
  });

  // Seller A's single 2500g item must match the 2001-3000g slab (Rs 100) on
  // its own — never blended with seller B's 300g item (which would pull the
  // combined weight, and therefore the slab, in a different direction if
  // the two sellers were ever incorrectly grouped together).
  assert.equal(settlementA.sellerOrderTotalWeightGrams, 2500);
  assert.equal(Number(settlementA.sellerOrderLogisticsCharge), 100);
  assert.equal(settlementB.sellerOrderTotalWeightGrams, 300);
  assert.equal(Number(settlementB.sellerOrderLogisticsCharge), 30);
});

test("missing/invalid item weight blocks the whole seller order's logistics calculation and flags every line NEEDS_REVIEW, never a silent ₹0", async () => {
  const sellerId = await makeSeller("InvalidWeight", 10, 10);
  const customerId = await makeCustomer("InvalidWeight");
  const productA = await makeProduct(sellerId, "InvalidWeightA", 500, 18);
  const productB = await makeProduct(sellerId, "InvalidWeightB", 300, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: productA,
        productName: "Item A",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 18,
        unitWeightGrams: 500,
      },
      {
        productId: productB,
        productName: "Item B (bad weight)",
        unitPrice: 300,
        quantity: 1,
        taxRatePercent: 18,
        unitWeightGrams: 0,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlementA = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  const settlementB = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[1] },
  });

  for (const s of [settlementA, settlementB]) {
    assert.equal(s.status, "NEEDS_REVIEW");
    assert.match(s.reviewNote ?? "", /missing or invalid weight/i);
    assert.equal(Number(s.logisticSellerBorne), 0, "explicit zero pending review, not a charge");
    assert.equal(
      Number(s.collectionCharge),
      0,
      "collection charge is blocked too — it's the same order-level calculation call",
    );
    assert.equal(s.logisticsSlabSnapshot, null);
  }
  // Every other figure (price/GST/commission) is still fully computed —
  // the row stays visible and useful, only logistics/collection are blocked.
  assert.equal(Number(settlementA.grossCommission), round2(590 * 0.1)); // 500*1.18=590, 10% commission
});

test("a SETTLED settlement is never recomputed or overwritten, even if logistics/collection config changes afterward", async () => {
  const sellerId = await makeSeller("FinalizedProtected", 10, 10);
  const customerId = await makeCustomer("FinalizedProtected");
  const productId = await makeProduct(sellerId, "FinalizedProtected", 500, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 500, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  await prisma.sellerSettlement.update({
    where: { orderItemId: itemIds[0] },
    data: { status: "SETTLED", settledAt: new Date() },
  });
  const before = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });

  const result = await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.skipped, 1, "a SETTLED row must be skipped, never recomputed");

  const after = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  assert.equal(Number(after.logisticSellerBorne), Number(before.logisticSellerBorne));
  assert.equal(Number(after.collectionCharge), Number(before.collectionCharge));
  assert.equal(Number(after.payableToSeller), Number(before.payableToSeller));
  assert.equal(after.status, "SETTLED");
  assert.equal(
    after.calculationVersion,
    before.calculationVersion,
    "a finalized row keeps whatever calculation version it was created under",
  );
});

test("delivery date: captured from the real DELIVERED status-history event, left null (not invented) for a legacy row with no such history", async () => {
  const sellerId = await makeSeller("DeliveryDate", 10, 10);
  const customerId = await makeCustomer("DeliveryDate");
  const productId = await makeProduct(sellerId, "DeliveryDate", 500, 18);

  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 500, quantity: 1, taxRatePercent: 18 },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, sellerOrderId);
  const settlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: itemIds[0] },
  });
  const historyRow = await prisma.orderStatusHistory.findFirstOrThrow({
    where: { sellerOrderId, status: "DELIVERED" },
  });
  assert.ok(settlement.deliveredAt);
  assert.equal(settlement.deliveredAt!.getTime(), historyRow.createdAt.getTime());

  // A legacy row: SellerOrder.status forced to DELIVERED directly (bypassing
  // transitionSellerOrder), so no DELIVERED OrderStatusHistory row exists —
  // exactly the "no trustworthy delivery timestamp" case the task requires
  // to be left blank rather than falling back to updatedAt.
  const legacyProductId = await makeProduct(sellerId, "DeliveryDateLegacy", 500, 18);
  const legacy = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: legacyProductId,
        productName: "Legacy Product",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 18,
      },
    ],
  });
  await prisma.orderStatusHistory.deleteMany({
    where: { sellerOrderId: legacy.sellerOrderId, status: "DELIVERED" },
  });
  await upsertSettlementsForSellerOrder(prisma, legacy.sellerOrderId);
  const legacySettlement = await prisma.sellerSettlement.findFirstOrThrow({
    where: { orderItemId: legacy.itemIds[0] },
  });
  assert.equal(
    legacySettlement.deliveredAt,
    null,
    "no DELIVERED history row -> deliveredAt must stay null, never fall back to updatedAt",
  );
});

test("commission table shows both a delivered and a still-pending order for the same seller — the root-cause fix for orders missing from the commission table", async () => {
  const sellerId = await makeSeller("CommTable", 10, 10);
  const customerId = await makeCustomer("CommTable");
  const deliveredProductId = await makeProduct(sellerId, "CommTableDelivered", 500, 18);
  const pendingProductId = await makeProduct(sellerId, "CommTablePending", 300, 18);

  const delivered = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      {
        productId: deliveredProductId,
        productName: "Delivered Product",
        unitPrice: 500,
        quantity: 1,
        taxRatePercent: 18,
      },
    ],
  });
  await upsertSettlementsForSellerOrder(prisma, delivered.sellerOrderId);

  const pending = await seedNonDeliveredOrder({
    sellerId,
    customerId,
    productId: pendingProductId,
    unitPrice: 300,
    taxRatePercent: 18,
  });

  // The old (settlement-only) query only ever sees the delivered order —
  // this is the exact bug: a legitimate order visible on /seller/orders is
  // invisible here.
  const settlementsOnly = await listSettlements(sellerId);
  assert.equal(settlementsOnly.rows.length, 1);
  assert.equal(settlementsOnly.rows[0]!.sellerOrderId, delivered.sellerOrderId);

  // The item-level commission table sees BOTH — every order item the seller
  // owns, regardless of delivery status.
  const commissionRows = await listCommissionTableRows(sellerId);
  assert.equal(commissionRows.total, 2);
  const deliveredRow = commissionRows.rows.find((r) => r.id === delivered.itemIds[0]);
  const pendingRow = commissionRows.rows.find((r) => r.id === pending.itemId);
  assert.ok(deliveredRow, "the delivered order's item must appear");
  assert.ok(pendingRow, "the still-pending order's item must also appear");
  assert.ok(deliveredRow!.settlement, "the delivered item has a real settlement");
  assert.equal(pendingRow!.settlement, null, "the pending item has no settlement row yet");
  assert.equal(
    pendingRow!.sellerOrder.status,
    "CONFIRMED",
    "the pending item's LIVE order status is shown, not a stale snapshot",
  );
});

test("commission table respects seller data isolation: one seller can never see another seller's items", async () => {
  const sellerA = await makeSeller("CommIsoA", 10, 10);
  const sellerB = await makeSeller("CommIsoB", 10, 10);
  const customerId = await makeCustomer("CommIso");
  const productA = await makeProduct(sellerA, "CommIsoA", 400, 18);
  const productB = await makeProduct(sellerB, "CommIsoB", 400, 18);

  await seedNonDeliveredOrder({
    sellerId: sellerA,
    customerId,
    productId: productA,
    unitPrice: 400,
    taxRatePercent: 18,
  });
  await seedNonDeliveredOrder({
    sellerId: sellerB,
    customerId,
    productId: productB,
    unitPrice: 400,
    taxRatePercent: 18,
  });

  const forA = await listCommissionTableRows(sellerA);
  const forB = await listCommissionTableRows(sellerB);
  assert.equal(forA.total, 1);
  assert.equal(forB.total, 1);
  assert.notEqual(forA.rows[0]!.id, forB.rows[0]!.id);
});

test("reconciliation/backfill is safe to run more than once: no duplicates, missing rows get created, a second run finds nothing new to create", async () => {
  const sellerId = await makeSeller("Reconcile", 10, 10);
  const customerId = await makeCustomer("Reconcile");
  const productId = await makeProduct(sellerId, "Reconcile", 800, 18);
  const { sellerOrderId, itemIds } = await seedDeliveredSellerOrder({
    sellerId,
    customerId,
    customerType: "CUSTOMER",
    items: [
      { productId, productName: "Test Product", unitPrice: 800, quantity: 1, taxRatePercent: 18 },
    ],
  });
  // Deliberately no upsertSettlementsForSellerOrder call here — this order
  // is DELIVERED but has no settlement row yet, exactly the state the
  // reconciliation script exists to fix.

  const first = await reconcileSellerSettlements({ sellerId });
  assert.equal(first.missingRowsFound, 1);
  assert.equal(first.rowsCreated, 1);
  assert.equal(first.errored, 0);
  const afterFirst = await prisma.sellerSettlement.findMany({ where: { sellerOrderId } });
  assert.equal(afterFirst.length, 1);

  const second = await reconcileSellerSettlements({ sellerId });
  assert.equal(second.missingRowsFound, 0, "nothing missing on the second run");
  assert.equal(second.rowsCreated, 0, "must not create a duplicate row");
  const afterSecond = await prisma.sellerSettlement.findMany({ where: { sellerOrderId } });
  assert.equal(afterSecond.length, 1, "still exactly one row per item after a second run");
  assert.equal(afterSecond[0]!.id, afterFirst[0]!.id);
  assert.equal(afterSecond[0]!.orderItemId, itemIds[0]);

  // Finalize the row, then confirm a third run never touches it.
  await prisma.sellerSettlement.update({
    where: { id: afterSecond[0]!.id },
    data: { status: "SETTLED", settledAt: new Date() },
  });
  const third = await reconcileSellerSettlements({ sellerId });
  assert.equal(third.skippedFinalized, 1);
  const afterThird = await prisma.sellerSettlement.findFirstOrThrow({ where: { sellerOrderId } });
  assert.equal(
    afterThird.status,
    "SETTLED",
    "a finalized row is never recomputed or overwritten by reconciliation",
  );
});
