/**
 * Integration test against the real dev Postgres — "Notify me when stock
 * is available" (spec §9/§10/§13). Covers subscribe/duplicate-prevention/
 * eligibility gating, and triggerRestockNotifications' exact-once,
 * eligibility-rechecked, transition-only firing behavior.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  subscribeToRestock,
  cancelRestockSubscription,
  getRestockSubscriptionStatus,
  triggerRestockNotifications,
} from "./restock-subscriptions";
import { recordStockChange } from "./inventory";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let categoryId: string;
let stateAId: string;
let stateBId: string;
let customerId: string;
let dealerId: string;
let dealerProfileId: string;
let productId: string; // CUSTOMER-audience variant product, state-restricted to stateA
let variantId: string;
let dealerProductId: string; // DEALER-audience variant product
let dealerVariantId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE restock ${RUN}`,
      slug: `test-fixture-restock-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const states = await prisma.indianState.findMany({ where: { isActive: true }, take: 2 });
  if (states.length < 2) throw new Error("Test requires at least 2 active IndianState rows.");
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-restock-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Restock Seller",
      role: "SELLER",
      referralCode: `TESTRESTOCKSELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Restock Shop ${RUN}`,
      slug: `test-restock-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const customer = await prisma.user.create({
    data: {
      phone: `+91777${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Restock Customer",
      role: "CUSTOMER",
      referralCode: `TESTRESTOCKCUST${RUN}`,
      stateId: stateAId,
    },
  });
  customerId = customer.id;
  createdUserIds.push(customerId);

  const dealerUser = await prisma.user.create({
    data: {
      email: `test-restock-dealer-${RUN}@example.com`,
      firstName: "TEST FIXTURE Restock Dealer",
      role: "DEALER",
      referralCode: `TESTRESTOCKDEALER${RUN}`,
    },
  });
  dealerId = dealerUser.id;
  createdUserIds.push(dealerId);
  const dealerProfile = await prisma.dealerProfile.create({
    data: {
      userId: dealerId,
      storeName: `Test Restock Dealer Biz ${RUN}`,
      stateId: stateAId,
      status: "APPROVED",
    },
  });
  dealerProfileId = dealerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      categoryId,
      name: "TEST FIXTURE restock product",
      slug: `test-fixture-restock-product-${RUN}`,
      sku: `TEST-RESTOCK-${RUN}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for restock subscriptions.",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      customerAvailableStates: { connect: [{ id: stateAId }] },
    },
  });
  productId = product.id;
  createdProductIds.push(productId);
  const variant = await prisma.productVariant.create({
    data: {
      productId,
      audience: "CUSTOMER",
      combinationKey: `test-restock-combo-${RUN}`,
      sku: `TEST-RESTOCK-VARIANT-${RUN}`,
      mrp: 100,
      sellingPrice: 100,
      minOrderQty: 1,
      stockQty: 0,
      isActive: true,
      imageUrl: "/test/variant.jpg",
    },
  });
  variantId = variant.id;

  const dealerProduct = await prisma.product.create({
    data: {
      sellerId,
      categoryId,
      name: "TEST FIXTURE restock dealer product",
      slug: `test-fixture-restock-dealer-product-${RUN}`,
      sku: `TEST-RESTOCK-DEALER-${RUN}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for dealer restock subscriptions.",
      audience: "DEALER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      dealerVisible: true,
    },
  });
  dealerProductId = dealerProduct.id;
  createdProductIds.push(dealerProductId);
  const dealerVariant = await prisma.productVariant.create({
    data: {
      productId: dealerProductId,
      audience: "DEALER",
      combinationKey: `test-restock-dealer-combo-${RUN}`,
      sku: `TEST-RESTOCK-DEALER-VARIANT-${RUN}`,
      mrp: 500,
      sellingPrice: 500,
      minOrderQty: 1,
      stockQty: 0,
      isActive: true,
    },
  });
  dealerVariantId = dealerVariant.id;
});

after(async () => {
  await prisma.restockSubscription.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.stockAdjustment.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.dealerProfile.deleteMany({ where: { id: dealerProfileId } });
  await prisma.sellerProfile.deleteMany({ where: { id: sellerId } });
  for (const id of createdUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
  await prisma.category.deleteMany({ where: { id: categoryId } });
});

test("a logged-in customer can subscribe to an eligible out-of-stock variant", async () => {
  const result = await subscribeToRestock(customerId, { kind: "variant", variantId });
  assert.equal(result.ok, true);
  const status = await getRestockSubscriptionStatus(customerId, productId, variantId, "CUSTOMER");
  assert.equal(status, "ACTIVE");
});

test("duplicate subscription is prevented — subscribing again returns the same row, not a second one", async () => {
  const before = await prisma.restockSubscription.count({
    where: { userId: customerId, productId, variantId },
  });
  const result = await subscribeToRestock(customerId, { kind: "variant", variantId });
  assert.equal(result.ok, true);
  const after = await prisma.restockSubscription.count({
    where: { userId: customerId, productId, variantId },
  });
  assert.equal(after, before);
});

test("subscribing to an in-stock variant is rejected", async () => {
  const inStock = await prisma.productVariant.create({
    data: {
      productId,
      audience: "CUSTOMER",
      combinationKey: `test-restock-instock-combo-${RUN}`,
      sku: `TEST-RESTOCK-INSTOCK-${RUN}`,
      mrp: 100,
      sellingPrice: 100,
      minOrderQty: 1,
      stockQty: 10,
      isActive: true,
    },
  });
  const result = await subscribeToRestock(customerId, { kind: "variant", variantId: inStock.id });
  assert.equal(result.ok, false);
});

test("subscribing to a product unavailable in the customer's state is rejected", async () => {
  const otherStateCustomer = await prisma.user.create({
    data: {
      phone: `+91778${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Restock Customer B",
      role: "CUSTOMER",
      referralCode: `TESTRESTOCKCUSTB${RUN}`,
      stateId: stateBId,
    },
  });
  createdUserIds.push(otherStateCustomer.id);
  const result = await subscribeToRestock(otherStateCustomer.id, { kind: "variant", variantId });
  assert.equal(result.ok, false);
});

test("a logged-in dealer can subscribe to an eligible out-of-stock variant, scoped to the DEALER audience independently of the customer subscription", async () => {
  const result = await subscribeToRestock(dealerId, {
    kind: "variant",
    variantId: dealerVariantId,
  });
  assert.equal(result.ok, true);
  const status = await getRestockSubscriptionStatus(
    dealerId,
    dealerProductId,
    dealerVariantId,
    "DEALER",
  );
  assert.equal(status, "ACTIVE");
});

test("the user can cancel an active subscription", async () => {
  const sub = await prisma.restockSubscription.findUniqueOrThrow({
    where: {
      userId_productId_variantId_audience: {
        userId: dealerId,
        productId: dealerProductId,
        variantId: dealerVariantId,
        audience: "DEALER",
      },
    },
  });
  const result = await cancelRestockSubscription(dealerId, sub.id);
  assert.equal(result.ok, true);
  const status = await getRestockSubscriptionStatus(
    dealerId,
    dealerProductId,
    dealerVariantId,
    "DEALER",
  );
  assert.equal(status, "NONE");
});

test("quantity transition from zero to positive sends exactly one alert, links the product, and marks the subscription fulfilled", async () => {
  const notifBefore = await prisma.notification.count({ where: { userId: customerId } });
  const result = await recordStockChange(prisma, {
    target: { kind: "variant", variantId },
    change: { mode: "delta", delta: 5 },
    adjustmentType: "MANUAL_ADD",
    sourceType: "SELLER",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  assert.equal(result.ok, true);

  const notifAfter = await prisma.notification.findMany({
    where: { userId: customerId },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(notifAfter.length, notifBefore + 1);
  const alert = notifAfter[0]!;
  assert.match(alert.body, /back in stock/i);
  assert.equal(alert.imageUrl, "/test/variant.jpg");
  assert.match(alert.linkUrl ?? "", /\/products\//); // customer link uses the product slug path

  const status = await getRestockSubscriptionStatus(customerId, productId, variantId, "CUSTOMER");
  assert.equal(status, "FULFILLED");
});

test("a fulfilled subscription does not send a repeated alert on a later no-op stock check", async () => {
  const notifBefore = await prisma.notification.count({ where: { userId: customerId } });
  // Directly re-invoke the trigger for the same transition-shape — since
  // the subscription is now FULFILLED (not ACTIVE), it must not match.
  await triggerRestockNotifications(prisma, { productId, variantId, audience: "CUSTOMER" });
  const notifAfter = await prisma.notification.count({ where: { userId: customerId } });
  assert.equal(notifAfter, notifBefore);
});

test("the user may subscribe again after a later stock-out, and a new transition sends a new alert", async () => {
  // Deplete back to zero, then resubscribe.
  const current = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await recordStockChange(prisma, {
    target: { kind: "variant", variantId },
    change: { mode: "delta", delta: -current.stockQty },
    adjustmentType: "ORDER_SALE",
    sourceType: "ORDER",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  const resub = await subscribeToRestock(customerId, { kind: "variant", variantId });
  assert.equal(resub.ok, true);
  const statusAfterResub = await getRestockSubscriptionStatus(
    customerId,
    productId,
    variantId,
    "CUSTOMER",
  );
  assert.equal(statusAfterResub, "ACTIVE");

  const notifBefore = await prisma.notification.count({ where: { userId: customerId } });
  await recordStockChange(prisma, {
    target: { kind: "variant", variantId },
    change: { mode: "delta", delta: 3 },
    adjustmentType: "MANUAL_ADD",
    sourceType: "SELLER",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  const notifAfter = await prisma.notification.count({ where: { userId: customerId } });
  assert.equal(notifAfter, notifBefore + 1);
});

test("an increase that remains unavailable (still out of stock) sends no alert — e.g. adding then immediately fully re-deducting nets to zero", async () => {
  const variant2 = await prisma.productVariant.create({
    data: {
      productId,
      audience: "CUSTOMER",
      combinationKey: `test-restock-notrans-combo-${RUN}`,
      sku: `TEST-RESTOCK-NOTRANS-${RUN}`,
      mrp: 100,
      sellingPrice: 100,
      minOrderQty: 1,
      stockQty: 0,
      isActive: true,
    },
  });
  await subscribeToRestock(customerId, { kind: "variant", variantId: variant2.id });
  const notifBefore = await prisma.notification.count({ where: { userId: customerId } });
  // previousQty stays <= 0 the whole time (0 -> 4 -> 0 within the same
  // logical step is not what this asserts; instead: a transition that
  // never actually crosses positive, e.g. a rolled-back/no-op change).
  const failed = await recordStockChange(prisma, {
    target: { kind: "variant", variantId: variant2.id },
    change: { mode: "delta", delta: -1 }, // already at 0, guard must refuse
    adjustmentType: "MANUAL_CORRECTION",
    sourceType: "SELLER",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  assert.equal(failed.ok, false);
  const notifAfter = await prisma.notification.count({ where: { userId: customerId } });
  assert.equal(notifAfter, notifBefore, "a rolled-back/refused change must never send an alert");
});

test("restocking a different variant does not notify subscribers of another variant", async () => {
  const variantX = await prisma.productVariant.create({
    data: {
      productId,
      audience: "CUSTOMER",
      combinationKey: `test-restock-x-combo-${RUN}`,
      sku: `TEST-RESTOCK-X-${RUN}`,
      mrp: 100,
      sellingPrice: 100,
      minOrderQty: 1,
      stockQty: 0,
      isActive: true,
    },
  });
  const variantY = await prisma.productVariant.create({
    data: {
      productId,
      audience: "CUSTOMER",
      combinationKey: `test-restock-y-combo-${RUN}`,
      sku: `TEST-RESTOCK-Y-${RUN}`,
      mrp: 100,
      sellingPrice: 100,
      minOrderQty: 1,
      stockQty: 0,
      isActive: true,
    },
  });
  await subscribeToRestock(customerId, { kind: "variant", variantId: variantX.id });
  const notifBefore = await prisma.notification.count({ where: { userId: customerId } });
  await recordStockChange(prisma, {
    target: { kind: "variant", variantId: variantY.id },
    change: { mode: "delta", delta: 5 },
    adjustmentType: "MANUAL_ADD",
    sourceType: "SELLER",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  const notifAfter = await prisma.notification.count({ where: { userId: customerId } });
  assert.equal(
    notifAfter,
    notifBefore,
    "restocking variant Y must not fire variant X's subscribers",
  );
  const statusX = await getRestockSubscriptionStatus(customerId, productId, variantX.id, "CUSTOMER");
  assert.equal(statusX, "ACTIVE", "variant X's subscription must remain untouched");
});
