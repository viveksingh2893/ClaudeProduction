/**
 * Integration test against the real dev Postgres — same throwaway-fixture
 * convention as admin-customer-orders.test.ts. Covers the new
 * listCheckoutGroupsForAdmin (spec §4's Checkout Groups table): search,
 * filters (customerType, state, status), and both the DB-level sort
 * (createdAt) and the in-process aggregate sort (totalAmount/orderCount),
 * plus pagination staying correct under the aggregate-sort path.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import { listCheckoutGroupsForAdmin } from "./order-queries";

const RUN = Date.now();

let sellerId: string;
let productId: string;
let customerAId: string;
let customerBId: string;
const cleanupUserIds: string[] = [];
let groupAId: string;
let groupBId: string;

async function addressPayload(name: string) {
  return {
    newAddress: {
      fullName: name,
      mobile: "+919999999995",
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
      email: `test-cg-admin-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTCGS${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test CG Admin Shop ${RUN}`,
      slug: `test-cg-admin-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test CG Admin Product ${RUN}`,
      slug: `test-cg-admin-product-${RUN}`,
      sku: `TEST-CGA-${RUN}`,
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
      phone: `+91906${RUN.toString().slice(-7)}`,
      firstName: `TEST FIXTURE CG Customer A ${RUN}`,
      role: "CUSTOMER",
      referralCode: `TESTCGA${RUN}`,
    },
  });
  customerAId = customerA.id;
  cleanupUserIds.push(customerA.id);

  const customerB = await prisma.user.create({
    data: {
      phone: `+91907${RUN.toString().slice(-7)}`,
      firstName: `TEST FIXTURE CG Customer B ${RUN}`,
      role: "CUSTOMER",
      referralCode: `TESTCGB${RUN}`,
    },
  });
  customerBId = customerB.id;
  cleanupUserIds.push(customerB.id);

  // Customer A: quantity 1 (small total), Customer B: quantity 5 (large total) —
  // gives search/filter/sort tests something concrete to distinguish.
  await addToCart(customerAId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 1 });
  const resultA = await checkout(
    customerAId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload("CG Customer A")),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-cg-admin-a-${RUN}`,
    },
  );
  assert.equal(resultA.ok, true);
  if (resultA.ok) groupAId = resultA.checkoutGroupId;

  await addToCart(customerBId, { role: "CUSTOMER", dealerStateId: null }, { productId, quantity: 5 });
  const resultB = await checkout(
    customerBId,
    { role: "CUSTOMER", dealerState: null },
    {
      ...(await addressPayload("CG Customer B")),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-cg-admin-b-${RUN}`,
    },
  );
  assert.equal(resultB.ok, true);
  if (resultB.ok) groupBId = resultB.checkoutGroupId;
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

test("search matches by customer name and never returns an unrelated checkout group", async () => {
  const result = await listCheckoutGroupsForAdmin({ search: `CG Customer A ${RUN}`, pageSize: 50 });
  assert.ok(result.rows.some((r) => r.id === groupAId));
  assert.ok(!result.rows.some((r) => r.id === groupBId));
});

test("customerType filter scopes to CUSTOMER (customer) groups", async () => {
  const result = await listCheckoutGroupsForAdmin({
    customerType: "CUSTOMER",
    search: `Customer A ${RUN}`,
    pageSize: 50,
  });
  assert.ok(result.rows.every((r) => r.customerType === "CUSTOMER"));
});

test("state filter matches the delivery address state case-insensitively", async () => {
  const result = await listCheckoutGroupsForAdmin({ state: "maharashtra", search: `CG Customer A ${RUN}` });
  assert.ok(result.rows.some((r) => r.id === groupAId));
});

test("state filter excludes a group with a different delivery state", async () => {
  const result = await listCheckoutGroupsForAdmin({ state: "Gujarat", search: `CG Customer A ${RUN}` });
  assert.ok(!result.rows.some((r) => r.id === groupAId));
});

test("computed columns (orderCount, sellerCount, itemCount, totalAmount) are correct for a fixture group", async () => {
  const result = await listCheckoutGroupsForAdmin({ search: `CG Customer B ${RUN}` });
  const row = result.rows.find((r) => r.id === groupBId);
  assert.ok(row);
  assert.equal(row!.orderCount, 1);
  assert.equal(row!.sellerCount, 1);
  assert.equal(row!.itemCount, 1);
  assert.equal(row!.totalAmount, 1000); // 5 * 200
});

test("sorting by the aggregate totalAmount column (in-process sort path) orders correctly and still paginates", async () => {
  const asc = await listCheckoutGroupsForAdmin({
    search: RUN.toString(),
    sortKey: "totalAmount",
    sortDir: "asc",
    pageSize: 1,
    page: 1,
  });
  assert.equal(asc.rows.length, 1);
  assert.equal(asc.rows[0]!.id, groupAId, "the smaller-total group must come first ascending");

  const page2 = await listCheckoutGroupsForAdmin({
    search: RUN.toString(),
    sortKey: "totalAmount",
    sortDir: "asc",
    pageSize: 1,
    page: 2,
  });
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.rows[0]!.id, groupBId, "the larger-total group must be on the next page");
});

test("sorting by createdAt (the true DB-level sort path) still works", async () => {
  const result = await listCheckoutGroupsForAdmin({
    search: RUN.toString(),
    sortKey: "createdAt",
    sortDir: "asc",
  });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.indexOf(groupAId) < ids.indexOf(groupBId), "A was created before B");
});
