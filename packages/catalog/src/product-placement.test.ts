/**
 * Integration test against the real dev Postgres (same connection
 * seed.ts uses). Uses its own throwaway MerchandisingCollection
 * (type: "TRENDING", categoryId: null already exists per the app's
 * normal usage — findFirst-or-create is exercised for real by
 * setProductSectionPlacement itself) and throwaway product fixtures,
 * cleaned up after.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  setProductSectionPlacement,
  getProductPlacementsMap,
  maxItemsForSection,
} from "./product-placement";

let sellerId: string;
let categoryId: string;
let approvedProductIds: string[] = [];
let draftProductId: string;

before(async () => {
  const seller = await prisma.sellerProfile.findFirstOrThrow({ where: { status: "APPROVED" } });
  sellerId = seller.id;
  // Excludes other suites' throwaway "TEST FIXTURE ..." categories (e.g.
  // category-hierarchy.test.ts) — node:test runs files concurrently, and
  // an unfiltered findFirstOrThrow() here previously raced with one of
  // those, picking up a category that got deleted out from under this
  // product's foreign key before this suite's own cleanup ran.
  const category = await prisma.category.findFirstOrThrow({
    where: { name: { not: { startsWith: "TEST FIXTURE" } } },
  });
  categoryId = category.id;

  const stamp = Date.now();
  const baseData = {
    sellerId,
    categoryId,
    hsnCode: "000000",
    shortDescription: "Regression test fixture",
    description: "Regression test fixture for homepage product placement.",
    productType: "PHYSICAL" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
    audience: "BOTH_CUSTOMER_AND_DEALER" as const,
    customerVisible: true,
    dealerVisible: true,
    customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
  };

  const created = await Promise.all(
    Array.from({ length: 14 }, (_, i) =>
      prisma.product.create({
        data: {
          ...baseData,
          name: `TEST FIXTURE Placement Product ${i} ${stamp}`,
          slug: `test-fixture-placement-${i}-${stamp}`,
          sku: `TEST-FIXTURE-PLACEMENT-${i}-${stamp}`,
          lifecycleStatus: "APPROVED",
        },
      }),
    ),
  );
  approvedProductIds = created.map((p) => p.id);

  const draft = await prisma.product.create({
    data: {
      ...baseData,
      name: `TEST FIXTURE Placement Draft ${stamp}`,
      slug: `test-fixture-placement-draft-${stamp}`,
      sku: `TEST-FIXTURE-PLACEMENT-DRAFT-${stamp}`,
      lifecycleStatus: "DRAFT",
    },
  });
  draftProductId = draft.id;
});

after(async () => {
  const allIds = [...approvedProductIds, draftProductId];
  await prisma.merchandisingItem.deleteMany({ where: { productId: { in: allIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: allIds } } });
  await prisma.product.deleteMany({ where: { id: { in: allIds } } });
});

test("adding a product sets its position and it appears in the placement map", async () => {
  const [p0] = approvedProductIds;
  const result = await setProductSectionPlacement("TRENDING", p0!, 1);
  assert.equal(result.ok, true);

  const map = await getProductPlacementsMap();
  assert.equal(map.get(p0!)?.TRENDING, 1);
});

test("moving a product to an earlier position shifts the others down", async () => {
  const [p0, p1] = approvedProductIds;
  await setProductSectionPlacement("TRENDING", p0!, 1);
  await setProductSectionPlacement("TRENDING", p1!, 2);
  // Move p1 to the front.
  await setProductSectionPlacement("TRENDING", p1!, 1);

  const map = await getProductPlacementsMap();
  assert.equal(map.get(p1!)?.TRENDING, 1);
  assert.equal(map.get(p0!)?.TRENDING, 2);
});

test('"Not displayed" (position null) removes the product and closes the gap', async () => {
  const [p0, p1] = approvedProductIds;
  await setProductSectionPlacement("TRENDING", p0!, 1);
  await setProductSectionPlacement("TRENDING", p1!, 2);
  await setProductSectionPlacement("TRENDING", p0!, null);

  const map = await getProductPlacementsMap();
  assert.equal(map.get(p0!)?.TRENDING, undefined);
  assert.equal(map.get(p1!)?.TRENDING, 1);
});

test("a product past the section cap is rejected, without disturbing the last accepted position", async () => {
  // BEST_SELLERS is one global, real collection (categoryId: null) shared
  // with whatever the admin has already placed there — this dev database
  // already has real seed placements in it. Fill only up to the remaining
  // capacity instead of assuming the section starts empty, otherwise this
  // fails as soon as any seed/demo data occupies a slot.
  const cap = maxItemsForSection("BEST_SELLERS");
  const existing = await prisma.merchandisingItem.count({
    where: { collection: { type: "BEST_SELLERS", categoryId: null } },
  });
  const remaining = Math.max(0, cap - existing);
  const toFill = approvedProductIds.slice(0, remaining);
  const overflow = approvedProductIds[remaining]!;
  for (const [i, id] of toFill.entries()) {
    const result = await setProductSectionPlacement("BEST_SELLERS", id, i + 1);
    assert.equal(result.ok, true);
  }

  const rejected = await setProductSectionPlacement("BEST_SELLERS", overflow, 5);
  assert.equal(rejected.ok, false);

  const map = await getProductPlacementsMap();
  if (toFill.length > 0) {
    assert.equal(
      map.get(toFill[toFill.length - 1]!)?.BEST_SELLERS,
      toFill.length,
      "last accepted position must not have been silently dropped",
    );
  }
  assert.equal(map.get(overflow)?.BEST_SELLERS, undefined);
});

test("a non-approved product cannot be newly added", async () => {
  const result = await setProductSectionPlacement("NEW_ARRIVALS", draftProductId, 1);
  assert.equal(result.ok, false);
});

test("the three sections are ordered independently — the same product can hold different positions in each", async () => {
  const [p0] = approvedProductIds;
  await setProductSectionPlacement("TRENDING", p0!, 1);
  await setProductSectionPlacement("BEST_SELLERS", p0!, 10);

  const map = await getProductPlacementsMap();
  const placement = map.get(p0!);
  assert.equal(placement?.TRENDING, 1);
  assert.equal(placement?.BEST_SELLERS, 10);
});
