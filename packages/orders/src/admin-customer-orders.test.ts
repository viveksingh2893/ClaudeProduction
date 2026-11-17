/**
 * Integration test against the real dev Postgres — same throwaway-
 * fixture convention as customer-checkout.test.ts / wallet.test.ts. Covers
 * the admin customer/dealer detail page's order-history dependency:
 * listSellerOrdersForAdmin's new `customerId` filter must scope strictly
 * to that one customer (never leak a sibling customer's order into the
 * list), and each returned order must carry line items with quantities
 * (the include this session added alongside the filter).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import { listSellerOrdersForAdmin } from "./order-queries";

const RUN = Date.now();

let sellerId: string;
let productId: string;
let customerAId: string;
let customerBId: string;
const cleanupUserIds: string[] = [];
let sellerOrderAId: string;

async function addressPayload(name: string) {
  return {
    newAddress: {
      fullName: name,
      mobile: "+919999999996",
      altMobile: undefined,
      line1: "Fixture Road 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411004",
      addressType: "HOME" as const,
      isDefault: false,
    },
  };
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  const sellerUser = await prisma.user.create({
    data: {
      email: `test-admin-orders-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTAOS${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test Admin Orders Shop ${RUN}`,
      slug: `test-admin-orders-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Admin Orders Product ${RUN}`,
      slug: `test-admin-orders-product-${RUN}`,
      sku: `TEST-AOP-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId: category.id,
      audience: "CUSTOMER_ONLY",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: false,
      primaryImageUrl: "/test.jpg",
      customerConfig: {
        create: { mrp: 200, sellingPrice: 200, minOrderQty: 1, currentStock: 100, weight: 500 },
      },
    },
  });
  productId = product.id;

  const customerA = await prisma.user.create({
    data: {
      phone: `+91904${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Customer A",
      role: "CUSTOMER",
      referralCode: `TESTAOA${RUN}`,
    },
  });
  customerAId = customerA.id;
  cleanupUserIds.push(customerA.id);

  const customerB = await prisma.user.create({
    data: {
      phone: `+91905${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Customer B",
      role: "CUSTOMER",
      referralCode: `TESTAOB${RUN}`,
    },
  });
  customerBId = customerB.id;
  cleanupUserIds.push(customerB.id);

  await addToCart(customerAId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 3 });
  const resultA = await checkout(
    customerAId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload("Customer A")),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-admin-orders-a-${RUN}`,
    },
  );
  assert.equal(resultA.ok, true);
  if (resultA.ok) {
    const group = await prisma.checkoutGroup.findUnique({
      where: { id: resultA.checkoutGroupId },
      include: { sellerOrders: true },
    });
    sellerOrderAId = group!.sellerOrders[0]!.id;
  }

  await addToCart(customerBId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 2 });
  const resultB = await checkout(
    customerBId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload("Customer B")),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-admin-orders-b-${RUN}`,
    },
  );
  assert.equal(resultB.ok, true);
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
  await prisma.cartItem.deleteMany({ where: { sellerId } });
  await prisma.productCustomerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("listSellerOrdersForAdmin's customerId filter returns only that customer's orders", async () => {
  const result = await listSellerOrdersForAdmin({ customerId: customerAId, pageSize: 50 });
  assert.ok(result.rows.length > 0);
  assert.ok(
    result.rows.every((r) => r.customer.id === customerAId),
    "every returned row must belong to the filtered customer",
  );
  assert.ok(
    !result.rows.some((r) => r.customer.id === customerBId),
    "a different customer's order must never appear",
  );
});

test("each order returned for the admin detail page includes its line items with quantities", async () => {
  const result = await listSellerOrdersForAdmin({ customerId: customerAId, pageSize: 50 });
  const order = result.rows.find((r) => r.id === sellerOrderAId);
  assert.ok(order, "the fixture order was not found");
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0]!.quantity, 3);
  assert.equal(order.items[0]!.productName, `Test Admin Orders Product ${RUN}`);
});
