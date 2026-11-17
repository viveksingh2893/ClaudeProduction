/**
 * Integration test against the real dev Postgres — spec §1's "use the
 * selected state to determine which state-classified Customer products
 * the customer can view" (customerStateAvailabilityWhere / getCustomerCatalogue's
 * new customerStateId filter). Mirrors dealer-catalogue.test.ts's fixture
 * shape (nationwide vs. state-restricted product) but for the Customer
 * side, plus the `undefined` (don't filter — non-customer callers like
 * POS) vs. `null` (customer with no state chosen — nationwide only)
 * distinction that doesn't exist on the dealer side.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { getCustomerCatalogue } from "./queries";

let sellerId: string;
let categoryId: string;
let stateAId: string;
let stateBId: string;
let nationwideProductId: string;
let restrictedProductId: string;

before(async () => {
  const seller = await prisma.sellerProfile.findFirstOrThrow({ where: { status: "APPROVED" } });
  sellerId = seller.id;
  const category = await prisma.category.findFirstOrThrow({
    where: { name: { not: { startsWith: "TEST FIXTURE" } } },
  });
  categoryId = category.id;
  const states = await prisma.indianState.findMany({ take: 2 });
  if (states.length < 2) throw new Error("Test requires at least 2 seeded IndianState rows.");
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const baseProductData = {
    sellerId,
    categoryId,
    hsnCode: "000000",
    shortDescription: "Regression test fixture",
    description: "Regression test fixture for the customer catalogue state gate.",
    productType: "PHYSICAL" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
    lifecycleStatus: "APPROVED" as const,
    audience: "CUSTOMER_ONLY" as const,
    customerVisible: true,
    dealerVisible: false,
  };

  const nationwide = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE nationwide customer-catalogue product",
      slug: `test-fixture-nationwide-customer-${Date.now()}`,
      sku: `TEST-FIXTURE-NATIONWIDE-CUSTOMER-${Date.now()}`,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  nationwideProductId = nationwide.id;

  const restricted = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE state-restricted customer-catalogue product",
      slug: `test-fixture-restricted-customer-${Date.now()}`,
      sku: `TEST-FIXTURE-RESTRICTED-CUSTOMER-${Date.now()}`,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
      customerAvailableStates: { connect: [{ id: stateAId }] },
    },
  });
  restrictedProductId = restricted.id;
});

after(async () => {
  await prisma.productCustomerConfig.deleteMany({
    where: { productId: { in: [nationwideProductId, restrictedProductId] } },
  });
  await prisma.product.deleteMany({ where: { id: { in: [nationwideProductId, restrictedProductId] } } });
});

test("customerStateId omitted (undefined) — no filtering, both products visible (POS/admin-style callers)", async () => {
  const products = await getCustomerCatalogue({});
  const ids = products.map((p) => p.id);
  assert.ok(ids.includes(nationwideProductId));
  assert.ok(ids.includes(restrictedProductId));
});

test("customerStateId null — an authenticated customer with no state chosen sees only nationwide products", async () => {
  const products = await getCustomerCatalogue({ customerStateId: null });
  const ids = products.map((p) => p.id);
  assert.ok(ids.includes(nationwideProductId), "nationwide product must still be visible");
  assert.ok(
    !ids.includes(restrictedProductId),
    "a state-restricted product must be hidden until a state is chosen — never shown as if nationwide",
  );
});

test("customerStateId set to the covered state — both products visible", async () => {
  const products = await getCustomerCatalogue({ customerStateId: stateAId });
  const ids = products.map((p) => p.id);
  assert.ok(ids.includes(nationwideProductId));
  assert.ok(ids.includes(restrictedProductId));
});

test("customerStateId set to an uncovered state — the restricted product stays hidden", async () => {
  const products = await getCustomerCatalogue({ customerStateId: stateBId });
  const ids = products.map((p) => p.id);
  assert.ok(ids.includes(nationwideProductId));
  assert.ok(!ids.includes(restrictedProductId));
});
