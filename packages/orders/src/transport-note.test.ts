/**
 * Integration tests against the real dev Postgres — same throwaway-fixture
 * convention as dealer-add-to-cart.test.ts / customer-checkout.test.ts.
 * Covers the "My Own Transport" requirement: transportNote is mandatory
 * once the ROLE-resolved delivery method is TRANSPORT, never required (or
 * shown) for KISAN4U_COURIER, and the entered text is preserved on the
 * created SellerOrder. Transport shipping is always ₹0 (see charges.ts),
 * so this test needs no ShippingMethod configuration of any kind.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";

const RUN = Date.now();

let sellerId: string;
let stateId: string;
let productId: string;
let dealerUserId: string;
let dealerProfileId: string;

const cleanupUserIds: string[] = [];

async function addressPayload() {
  return {
    newAddress: {
      fullName: "Test Dealer",
      mobile: "+919999999998",
      altMobile: undefined,
      line1: "Dealer Road 1",
      cityTown: "Testville",
      district: "Test District",
      // Placeholder — resolveCheckoutAddress forces this to the dealer's
      // own verified state server-side regardless of what's submitted,
      // but the shared address schema still requires a non-empty string.
      state: "Placeholder State",
      pincode: "411002",
      addressType: "SHOP" as const,
      isDefault: false,
    },
  };
}

before(async () => {
  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  stateId = state.id;
  const category = await prisma.category.findFirstOrThrow();

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-transport-note-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTTNS${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test Transport Note Shop ${RUN}`,
      slug: `test-transport-note-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Transport Note Product ${RUN}`,
      slug: `test-transport-note-product-${RUN}`,
      sku: `TEST-TNP-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId: category.id,
      audience: "DEALER_ONLY",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      dealerVisible: true,
      customerVisible: false,
      primaryImageUrl: "/test.jpg",
      dealerAvailableStates: { connect: [{ id: stateId }] },
      dealerConfig: {
        create: { mrp: 500, sellingPrice: 500, minOrderQty: 1, currentStock: 100, weight: 1000 },
      },
    },
  });
  productId = product.id;

  const dealerUser = await prisma.user.create({
    data: {
      phone: `+91902${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Dealer",
      role: "DEALER",
      referralCode: `TESTTND${RUN}`,
    },
  });
  dealerUserId = dealerUser.id;
  cleanupUserIds.push(dealerUser.id);
  const dealerProfile = await prisma.dealerProfile.create({
    data: { userId: dealerUser.id, status: "APPROVED", stateId },
  });
  dealerProfileId = dealerProfile.id;
});

after(async () => {
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
  await prisma.cartItem.deleteMany({ where: { userId: dealerUserId } });
  await prisma.dealerProfile.delete({ where: { id: dealerProfileId } }).catch(() => {});
  await prisma.productDealerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("dealer Transport checkout without a transport note is rejected", async () => {
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "TRANSPORT",
      paymentMethod: "TRANSPORT_FULL_ONLINE",
      idempotencyKey: `test-transport-note-missing-${RUN}`,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "Transport note is required for Transport orders.");
});

test("dealer Transport checkout with a transport note succeeds and preserves the text on the seller order", async () => {
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "TRANSPORT",
      paymentMethod: "TRANSPORT_FULL_ONLINE",
      transportNote: "Deliver to the back gate, ask for Ramesh.",
      // Not testing payment collection here — force the mock provider
      // rather than a live Razorpay call (see checkout.ts's
      // applyInitialPayment: no devSimulate means a real Razorpay Order
      // gets created).
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-transport-note-present-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const group = await prisma.checkoutGroup.findUnique({
    where: { id: result.checkoutGroupId },
    include: { sellerOrders: true },
  });
  const order = group!.sellerOrders[0]!;
  assert.equal(order.transportNote, "Deliver to the back gate, ask for Ramesh.");
});

test("dealer Kisan4U Courier checkout never requires or stores a transport note", async () => {
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );
  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      transportNote: "This should be ignored for Kisan4U Courier.",
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-transport-note-courier-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const group = await prisma.checkoutGroup.findUnique({
    where: { id: result.checkoutGroupId },
    include: { sellerOrders: true },
  });
  const order = group!.sellerOrders[0]!;
  assert.equal(order.transportNote, null);
});
