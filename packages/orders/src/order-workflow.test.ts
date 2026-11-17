/**
 * Integration tests against the real dev Postgres — same fixture
 * convention as customer-checkout.test.ts/settlement.test.ts (throwaway rows
 * keyed by a unique RUN timestamp, cleaned up in `after`). Covers the new
 * §A work: the combined markPackedAndReadyForPickup action, the
 * buyer-notification side effects, and the admin-only post-pickup
 * logistics actions (which must work on ANY seller's order, unlike every
 * other seller-facing function in order-workflow.ts).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import {
  confirmOrder,
  acceptOrder,
  markPackedAndReadyForPickup,
  markPickedUp,
  adminMarkInTransit,
  adminMarkDelivered,
  adminMarkDeliveryFailed,
} from "./order-workflow";
import { sellerRejectOrder } from "./cancellation";
import { transitionSellerOrder } from "./status-transitions";

const RUN = Date.now();
let categoryId: string;
let sellerId: string;
let sellerUserId: string;
let productId: string;
const cleanupUserIds: string[] = [];
const cleanupCheckoutGroupIds: string[] = [];

async function makeCustomer(suffix: string) {
  const user = await prisma.user.create({
    data: {
      phone: `+91904${RUN.toString().slice(-6)}${suffix}`,
      firstName: "TEST FIXTURE Customer",
      role: "CUSTOMER",
      referralCode: `TESTOWFC${RUN}${suffix}`,
    },
  });
  cleanupUserIds.push(user.id);
  return user.id;
}

async function addressPayload() {
  return {
    newAddress: {
      fullName: "Test Recipient",
      mobile: "+919999999999",
      altMobile: undefined,
      line1: "Line 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME" as const,
      isDefault: false,
    },
  };
}

/** Places a real order via checkout() and accepts it — returns the SellerOrder id at SELLER_ACCEPTED. */
async function placeAndAcceptOrder(suffix: string) {
  const customerId = await makeCustomer(suffix);
  await addToCart(
    customerId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-owf-${RUN}-${suffix}`,
    },
  );
  assert.equal(result.ok, true, "test fixture checkout must succeed");
  if (!result.ok) throw new Error("unreachable");
  cleanupCheckoutGroupIds.push(result.checkoutGroupId);

  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  // Every order is now placed as "Pending" — the Kisan4U team confirms it
  // before the seller can act (see order-workflow.ts's confirmOrder).
  const confirmed = await confirmOrder(sellerUserId, order.id);
  assert.equal(confirmed.ok, true, "test fixture confirm must succeed");
  const pickupPoint = await prisma.sellerPickupPoint.findFirstOrThrow({
    where: { sellerId, isActive: true, approvalStatus: "APPROVED" },
  });
  const accepted = await acceptOrder(sellerId, sellerUserId, {
    sellerOrderId: order.id,
    pickupPointId: pickupPoint.id,
  });
  assert.equal(accepted.ok, true, "test fixture accept must succeed");
  return { sellerOrderId: order.id, customerId };
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-owf-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE OWF Seller",
      role: "SELLER",
      referralCode: `TESTOWFS${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  cleanupUserIds.push(sellerUserId);
  const seller = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test OWF Shop ${RUN}`,
      slug: `test-owf-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  await prisma.sellerPickupPoint.create({
    data: {
      sellerId,
      name: "Test OWF Pickup",
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

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test OWF Product ${RUN}`,
      slug: `test-owf-product-${RUN}`,
      sku: `TEST-OWF-${RUN}`,
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
        create: { mrp: 500, sellingPrice: 500, minOrderQty: 1, currentStock: 1000, weight: 500 },
      },
    },
  });
  productId = product.id;
});

after(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: cleanupUserIds } } });
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
  await prisma.sellerSettlement.deleteMany({
    where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } },
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
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.sellerPickupPoint.deleteMany({ where: { sellerId } });
  await prisma.productCustomerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("acceptOrder creates an 'accepted' notification for the buyer", async () => {
  const { customerId } = await placeAndAcceptOrder("accept");
  const notification = await prisma.notification.findFirst({
    where: { userId: customerId },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(notification, "expected a notification row for the buyer");
  assert.match(notification!.title.toLowerCase(), /accept/);
});

test("markPackedAndReadyForPickup moves SELLER_ACCEPTED straight to PICKUP_SCHEDULED in one call, creates a Shipment, and notifies the buyer with the exact 'ready for pickup' wording", async () => {
  const { sellerOrderId, customerId } = await placeAndAcceptOrder("packed");
  const result = await markPackedAndReadyForPickup(sellerId, sellerUserId, { sellerOrderId });
  assert.equal(result.ok, true);

  const order = await prisma.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    include: { shipment: true },
  });
  assert.equal(order.status, "PICKUP_SCHEDULED");
  assert.ok(order.shipment?.awbNumber, "a Shipment with an AWB must exist");

  const notification = await prisma.notification.findFirst({
    where: { userId: customerId, title: { contains: "packed" } },
  });
  assert.ok(notification);
  assert.match(notification!.body, /packed and is ready for pickup/i);
});

test("markPickedUp is still seller-scoped and notifies the buyer", async () => {
  const { sellerOrderId, customerId } = await placeAndAcceptOrder("pickedup");
  await markPackedAndReadyForPickup(sellerId, sellerUserId, { sellerOrderId });

  const wrongSellerAttempt = await markPickedUp(
    "not-a-real-seller-id",
    sellerUserId,
    sellerOrderId,
  );
  assert.equal(
    wrongSellerAttempt.ok,
    false,
    "a seller-scoped call must not succeed for an order that isn't this seller's own",
  );

  const result = await markPickedUp(sellerId, sellerUserId, sellerOrderId);
  assert.equal(result.ok, true);
  const order = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } });
  assert.equal(order.status, "PICKED_UP");

  const notification = await prisma.notification.findFirst({
    where: { userId: customerId, title: { contains: "picked up" } },
  });
  assert.ok(notification);
});

test("admin logistics actions (in transit / delivered) work on ANY seller's order, keep Shipment in sync, notify the buyer, and settlement is still created on delivery", async () => {
  const { sellerOrderId, customerId } = await placeAndAcceptOrder("admin-chain");
  await markPackedAndReadyForPickup(sellerId, sellerUserId, { sellerOrderId });
  await markPickedUp(sellerId, sellerUserId, sellerOrderId);

  // Deliberately an id that belongs to no seller at all — proves this isn't
  // scoped by sellerId the way markPickedUp/markInTransit (seller) are.
  const unrelatedAdminUserId = "not-any-sellers-id";

  const inTransit = await adminMarkInTransit(unrelatedAdminUserId, sellerOrderId);
  assert.equal(inTransit.ok, true);
  let order = await prisma.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    include: { shipment: { include: { statusHistory: true } } },
  });
  assert.equal(order.status, "IN_TRANSIT");
  assert.equal(
    order.shipment?.status,
    "IN_TRANSIT",
    "Shipment.status must stay in sync with SellerOrder.status",
  );
  assert.ok(order.shipment!.statusHistory.some((h) => h.status === "IN_TRANSIT"));

  const delivered = await adminMarkDelivered(unrelatedAdminUserId, sellerOrderId);
  assert.equal(delivered.ok, true);
  order = await prisma.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    include: { shipment: { include: { statusHistory: true } } },
  });
  assert.equal(order.status, "DELIVERED");
  assert.equal(order.shipment?.status, "DELIVERED");

  const settlementCount = await prisma.sellerSettlement.count({ where: { sellerOrderId } });
  assert.equal(
    settlementCount,
    1,
    "DELIVERED must still create exactly one settlement row, same as the seller-driven path",
  );

  const inTransitNotification = await prisma.notification.findFirst({
    where: { userId: customerId, title: { contains: "in transit" } },
  });
  const deliveredNotification = await prisma.notification.findFirst({
    where: { userId: customerId, title: { contains: "delivered" } },
  });
  assert.ok(inTransitNotification);
  assert.ok(deliveredNotification);
});

test("adminMarkDeliveryFailed notifies the buyer with the failure reason", async () => {
  const { sellerOrderId, customerId } = await placeAndAcceptOrder("admin-fail");
  await markPackedAndReadyForPickup(sellerId, sellerUserId, { sellerOrderId });
  await markPickedUp(sellerId, sellerUserId, sellerOrderId);
  await adminMarkInTransit("not-any-sellers-id", sellerOrderId);

  const failed = await adminMarkDeliveryFailed(
    "not-any-sellers-id",
    sellerOrderId,
    "Recipient unavailable",
  );
  assert.equal(failed.ok, true);
  const order = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } });
  assert.equal(order.status, "DELIVERY_FAILED");

  const notification = await prisma.notification.findFirst({
    where: { userId: customerId, title: { contains: "failed" } },
  });
  assert.ok(notification);
  assert.match(notification!.body, /Recipient unavailable/);
});

test("sellerRejectOrder notifies the buyer with the rejection reason", async () => {
  const customerId = await makeCustomer("reject");
  await addToCart(
    customerId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-owf-reject-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanupCheckoutGroupIds.push(result.checkoutGroupId);
  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  assert.equal((await confirmOrder(sellerUserId, order.id)).ok, true);

  const rejected = await sellerRejectOrder(sellerId, sellerUserId, {
    sellerOrderId: order.id,
    reason: "Out of stock unexpectedly",
  });
  assert.equal(rejected.ok, true);

  const notification = await prisma.notification.findFirst({
    where: { userId: customerId, title: { contains: "rejected" } },
  });
  assert.ok(notification);
  assert.match(notification!.body, /Out of stock unexpectedly/);
});

test("transitionSellerOrder (the generic admin override) refuses to move an order to SELLER_ACCEPTED without a pickup point, instead of silently skipping it", async () => {
  const customerId = await makeCustomer("adminoverride");
  await addToCart(
    customerId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    customerId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-owf-adminoverride-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanupCheckoutGroupIds.push(result.checkoutGroupId);
  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal((await confirmOrder(sellerUserId, order.id)).ok, true);
  const confirmedOrder = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(confirmedOrder.status, "CONFIRMED");
  assert.equal(confirmedOrder.pickupPointId, null);

  const overridden = await transitionSellerOrder(
    order.id,
    "SELLER_ACCEPTED",
    { id: sellerUserId, role: "ADMIN" },
    "ADMIN",
  );
  assert.equal(overridden.ok, false);
  if (overridden.ok) return;
  assert.match(overridden.error, /pickup point/i);

  const stillConfirmed = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(stillConfirmed.status, "CONFIRMED", "the blocked override must not have moved the order");
});
