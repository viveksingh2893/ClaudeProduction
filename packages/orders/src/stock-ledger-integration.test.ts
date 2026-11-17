/**
 * Integration test against the real dev Postgres — confirms the variant-
 * stock-management ledger (packages/catalog's recordStockChange) is
 * correctly wired into the REAL order lifecycle (checkout.ts/
 * cancellation.ts), not just unit-tested in isolation. Same fixture
 * convention as customer-checkout.test.ts (full addToCart + checkout()
 * calls against a throwaway product).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import { requestCancellation, decideCancellation } from "./cancellation";
import { confirmOrder } from "./order-workflow";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let categoryId: string;
let productId: string;
let adminUserId: string;

const cleanupUserIds: string[] = [];

async function makeCustomer(suffix: string) {
  const user = await prisma.user.create({
    data: {
      phone: `+91902${RUN.toString().slice(-6)}${suffix}`,
      firstName: "TEST FIXTURE Ledger Customer",
      role: "CUSTOMER",
      referralCode: `TESTSLI${RUN}${suffix}`,
    },
  });
  cleanupUserIds.push(user.id);
  return user.id;
}

async function addressPayload() {
  return {
    newAddress: {
      fullName: "Test Customer",
      mobile: "+919999999999",
      altMobile: undefined,
      line1: "Farm Road 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME" as const,
      isDefault: false,
    },
  };
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-stock-ledger-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Ledger Seller",
      role: "SELLER",
      referralCode: `TESTSLIS${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  cleanupUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Stock Ledger Shop ${RUN}`,
      slug: `test-stock-ledger-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `test-stock-ledger-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE Ledger Admin",
      role: "ADMIN",
      referralCode: `TESTSLIA${RUN}`,
    },
  });
  adminUserId = adminUser.id;
  cleanupUserIds.push(adminUserId);

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Stock Ledger Product ${RUN}`,
      slug: `test-stock-ledger-product-${RUN}`,
      sku: `TEST-SLI-${RUN}`,
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
      customerConfig: {
        create: { mrp: 200, sellingPrice: 200, minOrderQty: 1, currentStock: 50, weight: 500 },
      },
    },
  });
  productId = product.id;
});

after(async () => {
  await prisma.stockAdjustment.deleteMany({ where: { productId } });
  await prisma.paymentAllocation.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroup: { sellerOrders: { some: { sellerId } } } } },
  });
  await prisma.payment.deleteMany({
    where: { checkoutGroup: { sellerOrders: { some: { sellerId } } } },
  });
  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.orderItem.deleteMany({ where: { sellerOrder: { sellerId } } });
  const groups = await prisma.checkoutGroup.findMany({
    where: { sellerOrders: { some: { sellerId } } },
    select: { id: true },
  });
  await prisma.sellerOrder.deleteMany({ where: { sellerId } });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: { in: groups.map((g) => g.id) } },
  });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.productCustomerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("checkout no longer deducts stock; confirming the pending order deducts it via the shared ledger and writes exactly one ORDER_SALE StockAdjustment row referencing the order", async () => {
  const customerId = await makeCustomer("A");
  await addToCart(customerId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 2 });

  const before = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-sli-cod-${RUN}-a`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });

  // Placement alone reserves nothing — the order is "Pending".
  const afterCheckout = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(afterCheckout.currentStock, before.currentStock);
  assert.equal(
    await prisma.stockAdjustment.count({ where: { productId, relatedOrderId: order.id } }),
    0,
  );

  // Confirmation is where stock is deducted.
  assert.equal((await confirmOrder(adminUserId, order.id)).ok, true);

  const after = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(after.currentStock, before.currentStock - 2);

  const ledger = await prisma.stockAdjustment.findMany({
    where: { productId, relatedOrderId: order.id },
  });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]!.adjustmentType, "ORDER_SALE");
  assert.equal(ledger[0]!.sourceType, "ORDER");
  assert.equal(ledger[0]!.changeQty, -2);
  assert.equal(ledger[0]!.performedByUserId, adminUserId);
});

test("cancellation restores stock via the shared ledger and writes exactly one ORDER_CANCELLATION_RESTORE row; a second approval attempt is refused (idempotent, no double-restore)", async () => {
  const customerId = await makeCustomer("B");
  await addToCart(customerId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 3 });
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-sli-cod-${RUN}-b`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  // Confirm first — that's what deducts the stock this test then restores.
  assert.equal((await confirmOrder(adminUserId, order.id)).ok, true);
  const afterSale = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });

  const req = await requestCancellation(customerId, "CUSTOMER", {
    sellerOrderId: order.id,
    reason: "Changed my mind",
  });
  assert.equal(req.ok, true);

  const approve1 = await decideCancellation(adminUserId, {
    sellerOrderId: order.id,
    approve: true,
  });
  assert.equal(approve1.ok, true);
  const afterRestore = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(afterRestore.currentStock, afterSale.currentStock + 3);

  const restoreLedger = await prisma.stockAdjustment.findMany({
    where: { productId, relatedOrderId: order.id, adjustmentType: "ORDER_CANCELLATION_RESTORE" },
  });
  assert.equal(restoreLedger.length, 1);
  assert.equal(restoreLedger[0]!.changeQty, 3);
  assert.equal(restoreLedger[0]!.performedByUserId, adminUserId);
  assert.equal(restoreLedger[0]!.performedByRole, "ADMIN");

  // The order is now CANCELLED, not CANCELLATION_REQUESTED — a second
  // approve call must be refused by the precondition check, not silently
  // restore a second time.
  const approve2 = await decideCancellation(adminUserId, {
    sellerOrderId: order.id,
    approve: true,
  });
  assert.equal(approve2.ok, false);
  const afterSecondAttempt = await prisma.productCustomerConfig.findUniqueOrThrow({
    where: { productId },
  });
  assert.equal(
    afterSecondAttempt.currentStock,
    afterRestore.currentStock,
    "stock must not move on the refused second approval",
  );
  const restoreLedgerAfter = await prisma.stockAdjustment.findMany({
    where: { productId, relatedOrderId: order.id, adjustmentType: "ORDER_CANCELLATION_RESTORE" },
  });
  assert.equal(restoreLedgerAfter.length, 1, "still exactly one restoration ledger row");
});

test("a repeated checkout submission with the same idempotency key never deducts stock twice", async () => {
  const customerId = await makeCustomer("C");
  await addToCart(customerId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 1 });
  const before = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  const key = `test-sli-idem-${RUN}-c`;

  const first = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: key,
    },
  );
  assert.equal(first.ok, true);

  // Re-submitting with the exact same key replays the original success
  // (claimIdempotencyKey's `alreadyCompleted` branch, packages/orders/src/
  // idempotency.ts) rather than re-processing — it must return the SAME
  // checkoutGroupId and must never deduct stock a second time.
  const second = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: key,
    },
  );
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.checkoutGroupId, first.checkoutGroupId);

  // Neither checkout call deducts stock any more — that waits for
  // confirmation. The replay must also not have created a second seller
  // order, which would double-deduct when the order is confirmed.
  const afterReplay = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(afterReplay.currentStock, before.currentStock);
  const orders = await prisma.sellerOrder.findMany({
    where: { checkoutGroupId: first.checkoutGroupId },
  });
  assert.equal(orders.length, 1);

  assert.equal((await confirmOrder(adminUserId, orders[0]!.id)).ok, true);
  const afterConfirm = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(afterConfirm.currentStock, before.currentStock - 1);
  const ledger = await prisma.stockAdjustment.count({
    where: { productId, relatedOrderId: orders[0]!.id },
  });
  assert.equal(ledger, 1);
});
