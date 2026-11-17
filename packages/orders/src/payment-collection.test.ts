/**
 * Integration tests against the real dev Postgres — same fixture
 * convention as order-workflow.test.ts (throwaway rows keyed by a unique
 * RUN timestamp, cleaned up in `after`). Covers the payment-collection
 * feature end to end:
 *   - COD and the deferred remainder of ONLINE_PARTIAL are automatically
 *     marked collected the moment an order reaches DELIVERED (via the
 *     real markPackedAndReadyForPickup -> markPickedUp -> adminMarkInTransit
 *     -> adminMarkDelivered chain — not a direct DB seed), never before.
 *   - An already-fully-paid order (ONLINE_FULL) is untouched by delivery.
 *   - The admin's manual "record payment collected" action can complete
 *     or partially complete a COD/partial order before delivery, and
 *     rejects collecting more than what's actually outstanding.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, type PaymentMethod } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import {
  confirmOrder,
  acceptOrder,
  markPackedAndReadyForPickup,
  markPickedUp,
  adminMarkInTransit,
  adminMarkDelivered,
} from "./order-workflow";
import { recordPaymentCollected } from "./payment-collection";

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
      phone: `+91905${RUN.toString().slice(-6)}${suffix}`,
      firstName: "TEST FIXTURE Customer",
      role: "CUSTOMER",
      referralCode: `TESTPC${RUN}${suffix}`,
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

/** Places a real order via checkout() with the given payment method and accepts it — returns the SellerOrder id. */
async function placeAndAcceptOrder(suffix: string, paymentMethod: PaymentMethod) {
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
      paymentMethod,
      devSimulatePaymentOutcome: paymentMethod === "COD" ? undefined : "SUCCESS",
      idempotencyKey: `test-pc-${RUN}-${suffix}`,
    },
  );
  assert.equal(result.ok, true, "test fixture checkout must succeed");
  if (!result.ok) throw new Error("unreachable");
  cleanupCheckoutGroupIds.push(result.checkoutGroupId);

  const order = await prisma.sellerOrder.findFirstOrThrow({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  // Orders are now placed as "Pending" — an admin confirms before the
  // seller can act (order-workflow.ts's confirmOrder).
  assert.equal((await confirmOrder(sellerUserId, order.id)).ok, true, "test fixture confirm must succeed");
  const pickupPoint = await prisma.sellerPickupPoint.findFirstOrThrow({
    where: { sellerId, isActive: true, approvalStatus: "APPROVED" },
  });
  const accepted = await acceptOrder(sellerId, sellerUserId, {
    sellerOrderId: order.id,
    pickupPointId: pickupPoint.id,
  });
  assert.equal(accepted.ok, true, "test fixture accept must succeed");
  return order.id;
}

/** Drives a seller order all the way to DELIVERED via the real chain (not a direct status write) — this is what actually triggers autoCompletePaymentOnDelivery. */
async function deliverOrder(sellerOrderId: string) {
  await markPackedAndReadyForPickup(sellerId, sellerUserId, { sellerOrderId });
  await markPickedUp(sellerId, sellerUserId, sellerOrderId);
  await adminMarkInTransit("not-any-sellers-id", sellerOrderId);
  const delivered = await adminMarkDelivered("not-any-sellers-id", sellerOrderId);
  assert.equal(delivered.ok, true, "test fixture delivery must succeed");
}

async function paymentFor(sellerOrderId: string) {
  const allocation = await prisma.paymentAllocation.findFirstOrThrow({
    where: { sellerOrderId },
    include: { payment: true },
  });
  return allocation.payment;
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-pc-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE PC Seller",
      role: "SELLER",
      referralCode: `TESTPCS${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  cleanupUserIds.push(sellerUserId);
  const seller = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test PC Shop ${RUN}`,
      slug: `test-pc-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  await prisma.sellerPickupPoint.create({
    data: {
      sellerId,
      name: "Test PC Pickup",
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
      name: `Test PC Product ${RUN}`,
      slug: `test-pc-product-${RUN}`,
      sku: `TEST-PC-${RUN}`,
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
  await prisma.sellerSettlement.deleteMany({
    where: { checkoutGroupId: { in: cleanupCheckoutGroupIds } },
  });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
  });
  await prisma.paymentAllocation.deleteMany({
    where: { sellerOrder: { checkoutGroupId: { in: cleanupCheckoutGroupIds } } },
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
  await prisma.sellerPickupPoint.deleteMany({ where: { sellerId } });
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("COD: payment stays PENDING (₹0 collected) until delivery, then is automatically marked PAID in full", async () => {
  const sellerOrderId = await placeAndAcceptOrder("cod-auto", "COD");
  const before_ = await paymentFor(sellerOrderId);
  assert.equal(before_.status, "PENDING");
  assert.equal(Number(before_.amountPaid), 0);

  await deliverOrder(sellerOrderId);

  // Payment.amountPaid/totalAmount are deliberately left untouched (see
  // payment-collection.ts's file doc comment) — the collected cash is
  // recorded on PaymentAllocation.remainingCollectedAmount instead, and
  // only the Payment's display-facing status advances to PAID.
  const after_ = await paymentFor(sellerOrderId);
  assert.equal(after_.status, "PAID");
  assert.equal(Number(after_.amountPaid), 0);
  const allocation = await prisma.paymentAllocation.findFirstOrThrow({ where: { sellerOrderId } });
  assert.equal(Number(allocation.remainingCollectedAmount), Number(after_.totalAmount));
  const history = await prisma.paymentStatusHistory.findMany({
    where: { paymentId: after_.id },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(
    history.some((h) => h.status === "PAID" && h.source === "SYSTEM"),
    "the auto-completion must be attributed to SYSTEM, not ADMIN",
  );
});

test("ONLINE_PARTIAL: the advance is captured at checkout, the deferred remainder is automatically collected on delivery", async () => {
  const sellerOrderId = await placeAndAcceptOrder("partial-auto", "ONLINE_PARTIAL");
  const order = await prisma.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    include: { charge: true },
  });
  const netPayable = Number(order.charge!.customerPayableTotal);

  const before_ = await paymentFor(sellerOrderId);
  // Payment.totalAmount for a partial payment is scoped to the ADVANCE
  // only (see checkout.ts) — fully captured on success, so amountPaid ==
  // totalAmount here even though the seller order's own full netPayable
  // is larger; that's the whole reason payment-collection.ts tracks the
  // deferred remainder on PaymentAllocation.remainingCollectedAmount
  // instead of trying to reuse this Payment row's own totals.
  assert.equal(before_.status, "PARTIALLY_PAID");
  assert.equal(Number(before_.amountPaid), Number(before_.totalAmount));
  assert.ok(
    Number(before_.amountPaid) < netPayable,
    "the advance alone must be less than the full order amount",
  );

  await deliverOrder(sellerOrderId);

  const allocation = await prisma.paymentAllocation.findFirstOrThrow({ where: { sellerOrderId } });
  const after_ = await paymentFor(sellerOrderId);
  assert.equal(after_.status, "PAID");
  const totalCollected =
    Number(allocation.amount) * (Number(after_.amountPaid) / Number(after_.totalAmount)) +
    Number(allocation.remainingCollectedAmount);
  assert.equal(
    round2(totalCollected),
    netPayable,
    "advance + auto-collected remainder must equal the full order amount",
  );
});

test("ONLINE_FULL: already PAID at checkout, delivery does not double-collect or otherwise change it", async () => {
  const sellerOrderId = await placeAndAcceptOrder("full-auto", "ONLINE_FULL");
  const before_ = await paymentFor(sellerOrderId);
  assert.equal(before_.status, "PAID");
  const paidAtCheckout = Number(before_.amountPaid);

  await deliverOrder(sellerOrderId);

  const after_ = await paymentFor(sellerOrderId);
  assert.equal(after_.status, "PAID");
  assert.equal(
    Number(after_.amountPaid),
    paidAtCheckout,
    "must not add anything on top of an already-complete payment",
  );
});

test("admin manual action: a smaller-than-full amount records a genuine partial collection, and cannot exceed what's outstanding", async () => {
  const sellerOrderId = await placeAndAcceptOrder("cod-manual-partial", "COD");
  const payment = await paymentFor(sellerOrderId);
  const total = Number(payment.totalAmount);

  const tooMuch = await recordPaymentCollected(
    sellerOrderId,
    { id: "test-admin", role: "ADMIN" },
    total + 50,
  );
  assert.equal(tooMuch.ok, false);

  const half = round2(total / 2);
  const result = await recordPaymentCollected(
    sellerOrderId,
    { id: "test-admin", role: "ADMIN" },
    half,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.collected, half);

  const after_ = await paymentFor(sellerOrderId);
  assert.equal(after_.status, "PARTIALLY_PAID");
  const allocation = await prisma.paymentAllocation.findFirstOrThrow({ where: { sellerOrderId } });
  assert.equal(Number(allocation.remainingCollectedAmount), half);

  const history = await prisma.paymentStatusHistory.findMany({
    where: { paymentId: after_.id },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(history.some((h) => h.status === "PARTIALLY_PAID" && h.source === "ADMIN"));
});

test("admin manual action: omitting the amount collects the FULL outstanding balance", async () => {
  const sellerOrderId = await placeAndAcceptOrder("cod-manual-full", "COD");
  const payment = await paymentFor(sellerOrderId);

  const result = await recordPaymentCollected(sellerOrderId, { id: "test-admin", role: "ADMIN" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.collected, Number(payment.totalAmount));

  const after_ = await paymentFor(sellerOrderId);
  assert.equal(after_.status, "PAID");
});

test("admin manual action on an already-fully-paid order is a harmless no-op, never an error", async () => {
  const sellerOrderId = await placeAndAcceptOrder("full-manual-noop", "ONLINE_FULL");

  const result = await recordPaymentCollected(sellerOrderId, { id: "test-admin", role: "ADMIN" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.collected, 0);
});

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
