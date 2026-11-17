/**
 * Integration test against the real dev Postgres (same connection
 * seed.ts uses) — Homepage CMS "Deal of the Day" expiry enforcement
 * (Complete Design/Admin Spec §7.5): getActiveDealSellingPrice is the
 * authoritative override point validateCartLine calls, so this proves the
 * override applies within the active window, falls back once expired, and
 * never applies to the DEALER audience (see this function's own doc
 * comment for why — a flat deal price would otherwise leak a retail
 * promotional price into dealer checkout).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { getActiveDealSellingPrice } from "./pricing-resolution";

let sellerId: string;
let categoryId: string;
let productId: string;
let expiredProductId: string;
const dealIds: string[] = [];

before(async () => {
  const seller = await prisma.sellerProfile.findFirstOrThrow({ where: { status: "APPROVED" } });
  sellerId = seller.id;
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;

  const base = {
    sellerId,
    categoryId,
    hsnCode: "000000",
    shortDescription: "Regression test fixture",
    description: "Regression test fixture for getActiveDealSellingPrice.",
    productType: "PHYSICAL" as const,
    audience: "BOTH_CUSTOMER_AND_DEALER" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
    lifecycleStatus: "APPROVED" as const,
  };

  const active = await prisma.product.create({
    data: {
      ...base,
      name: "TEST FIXTURE active deal product",
      slug: `test-fixture-active-deal-${Date.now()}`,
      sku: `TEST-FIXTURE-ACTIVEDEAL-${Date.now()}`,
      customerConfig: { create: { mrp: 500, sellingPrice: 500 } },
      dealerConfig: { create: { mrp: 4500, sellingPrice: 4500 } },
    },
  });
  productId = active.id;

  const expired = await prisma.product.create({
    data: {
      ...base,
      name: "TEST FIXTURE expired deal product",
      slug: `test-fixture-expired-deal-${Date.now()}`,
      sku: `TEST-FIXTURE-EXPIREDDEAL-${Date.now()}`,
      customerConfig: { create: { mrp: 500, sellingPrice: 500 } },
      dealerConfig: { create: { mrp: 4500, sellingPrice: 4500 } },
    },
  });
  expiredProductId = expired.id;

  const now = new Date();
  const activeDeal = await prisma.dealOfTheDay.create({
    data: {
      productId,
      dealPrice: 249,
      startAt: new Date(now.getTime() - 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 60 * 60 * 1000),
      isActive: true,
    },
  });
  const expiredDeal = await prisma.dealOfTheDay.create({
    data: {
      productId: expiredProductId,
      dealPrice: 199,
      startAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      endAt: new Date(now.getTime() - 60 * 60 * 1000),
      isActive: true,
    },
  });
  dealIds.push(activeDeal.id, expiredDeal.id);
});

after(async () => {
  await prisma.dealOfTheDay.deleteMany({ where: { id: { in: dealIds } } });
  await prisma.productCustomerConfig.deleteMany({
    where: { productId: { in: [productId, expiredProductId] } },
  });
  await prisma.productDealerConfig.deleteMany({
    where: { productId: { in: [productId, expiredProductId] } },
  });
  await prisma.product.deleteMany({ where: { id: { in: [productId, expiredProductId] } } });
});

test("an active deal overrides the customer selling price within its window", async () => {
  const price = await getActiveDealSellingPrice(productId, null, "CUSTOMER");
  assert.equal(price, 249);
});

test("an expired deal returns null — falls back to the base config price", async () => {
  const price = await getActiveDealSellingPrice(expiredProductId, null, "CUSTOMER");
  assert.equal(price, null);
});

test("a product with no deal at all returns null", async () => {
  const price = await getActiveDealSellingPrice("nonexistent-product-id", null, "CUSTOMER");
  assert.equal(price, null);
});

test("an active deal never overrides the DEALER audience price, even though the deal row matches the product", async () => {
  const price = await getActiveDealSellingPrice(productId, null, "DEALER");
  assert.equal(price, null);
});
