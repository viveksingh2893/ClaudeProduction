/**
 * Integration tests against the real dev Postgres — creates its own
 * throwaway fixtures (unique slugs/emails via Date.now()), same
 * convention as phase4-security.test.ts. Runs full checkout() calls to
 * verify the corrective customer business rules end-to-end: single delivery
 * method enforced server-side even against a forged request, transport/
 * collection charges are seller-borne and excluded from what the customer
 * pays, and the 5%/2%/0% online-payment promotional discount is
 * calculated, stored, and attributed to Kisan4u — never trusting a
 * client-supplied discount value (there is none in the schema to trust).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";

const RUN = Date.now();

let sellerId: string;
let categoryId: string;
let productId: string;
let customerUserId: string;

const cleanupUserIds: string[] = [];

async function makeCustomer(suffix: string) {
  const user = await prisma.user.create({
    data: {
      phone: `+91901${RUN.toString().slice(-6)}${suffix}`,
      firstName: "TEST FIXTURE Customer",
      role: "CUSTOMER",
      referralCode: `TESTFC${RUN}${suffix}`,
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
      email: `test-customer-checkout-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTFCS${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test Customer Checkout Shop ${RUN}`,
      slug: `test-customer-checkout-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Customer Checkout Product ${RUN}`,
      slug: `test-customer-checkout-product-${RUN}`,
      sku: `TEST-FCP-${RUN}`,
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
        create: { mrp: 1000, sellingPrice: 1000, minOrderQty: 1, currentStock: 1000, weight: 500 },
      },
    },
  });
  productId = product.id;
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
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.productCustomerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("a forged TRANSPORT delivery method in the checkout payload is ignored for a customer — always KISAN4U_COURIER server-side", async () => {
  customerUserId = await makeCustomer("A");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "TRANSPORT" as never, // forged — a customer should never be able to select this
      paymentMethod: "COD",
      idempotencyKey: `test-forged-transport-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const group = await prisma.checkoutGroup.findUnique({
    where: { id: result.checkoutGroupId },
    include: { sellerOrders: { include: { charge: true } } },
  });
  const order = group!.sellerOrders[0]!;
  assert.equal(order.deliveryMethod, "KISAN4U_COURIER");
  assert.equal(order.charge!.transportationPayer, "SELLER");
  assert.equal(Number(order.charge!.customerPayableDelivery), 0);
});

test("customer COD: no promotional discount, customer pays transportation/collection charge = ₹0", async () => {
  customerUserId = await makeCustomer("B");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-customer-cod-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const charge = (await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  }))!.charge!;
  assert.equal(Number(charge.promotionalDiscountPercent), 0);
  assert.equal(Number(charge.promotionalDiscountAmount), 0);
  assert.equal(Number(charge.customerPayableDelivery), 0);
  assert.equal(Number(charge.collectionCharge) > 0, true);
  assert.equal(charge.collectionChargePayer, "SELLER");
});

test("customer full online payment: exactly 5% discount, Kisan4u is the payer, seller revenue (subtotal) is unaffected", async () => {
  customerUserId = await makeCustomer("C");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-customer-full-online-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const order = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  });
  assert.equal(Number(order!.charge!.promotionalDiscountPercent), 5);
  assert.equal(Number(order!.charge!.promotionalDiscountAmount), 50); // 5% of ₹1000
  assert.equal(order!.charge!.promotionalDiscountPayer, "KISAN4U");
  assert.equal(Number(order!.subtotal), 1000); // seller's own settlement basis, untouched by the Kisan4u-borne discount
  assert.equal(Number(order!.charge!.customerPayableTotal), 950);
  assert.equal(Number(order!.charge!.kisan4uBorneAmount), 50);
});

test("customer partial online payment: exactly 2% discount, applied before the advance split", async () => {
  customerUserId = await makeCustomer("D");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_PARTIAL",
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-customer-partial-online-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const order = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  });
  assert.equal(Number(order!.charge!.promotionalDiscountPercent), 2);
  assert.equal(Number(order!.charge!.promotionalDiscountAmount), 20); // 2% of ₹1000
  assert.equal(Number(order!.charge!.customerPayableTotal), 980);
});
