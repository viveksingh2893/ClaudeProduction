/**
 * Integration test against the real dev Postgres (same connection
 * seed.ts uses) — creates and tears down its own throwaway fixtures.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { recomputeProductRating } from "./ratings";

let sellerId: string;
let categoryId: string;
let productId: string;
const customerIds: string[] = [];
const reviewIds: string[] = [];

// A counter, not just Date.now(), guarantees uniqueness across calls made
// in the same millisecond (this file makes several in a tight sequential
// loop) — truncating a 13-digit timestamp down to a 10-digit phone number
// from the front keeps only its slow-changing high-order digits and
// silently collides otherwise.
let customerCounter = 0;
async function makeCustomer(tag: string) {
  customerCounter += 1;
  const phoneSuffix = `${Date.now()}${customerCounter}`.slice(-9);
  const user = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE rating customer ${tag}`,
      phone: `9${phoneSuffix}`,
      role: "CUSTOMER",
      referralCode: `TEST-RATING-${Date.now()}-${customerCounter}-${tag}`,
    },
  });
  customerIds.push(user.id);
  return user.id;
}

before(async () => {
  const seller = await prisma.sellerProfile.findFirstOrThrow({ where: { status: "APPROVED" } });
  sellerId = seller.id;
  // Excludes other suites' throwaway "TEST FIXTURE ..." categories — node:test
  // runs files concurrently, and an unfiltered query here can race with one
  // of those, picking up a category that suite deletes out from under this
  // product's foreign key before this suite's own cleanup runs.
  const category = await prisma.category.findFirstOrThrow({
    where: { name: { not: { startsWith: "TEST FIXTURE" } } },
  });
  categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      categoryId,
      name: "TEST FIXTURE rating product",
      slug: `test-fixture-rating-${Date.now()}`,
      sku: `TEST-FIXTURE-RATING-${Date.now()}`,
      hsnCode: "000000",
      shortDescription: "Regression test fixture",
      description: "Regression test fixture for recomputeProductRating.",
      productType: "PHYSICAL",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  productId = product.id;
});

after(async () => {
  await prisma.productReview.deleteMany({ where: { productId } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: { in: customerIds } } });
});

test("zero approved+verified reviews leaves ratingCount 0 and ratingAverage null", async () => {
  await recomputeProductRating(productId);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(product.ratingCount, 0);
  assert.equal(product.ratingAverage, null);
});

test("only approved AND verified-purchase reviews count toward the average", async () => {
  const c1 = await makeCustomer("approved-verified-1");
  const c2 = await makeCustomer("approved-verified-2");
  const c3 = await makeCustomer("pending");
  const c4 = await makeCustomer("approved-unverified");
  const c5 = await makeCustomer("rejected-verified");

  const r1 = await prisma.productReview.create({
    data: {
      productId,
      customerId: c1,
      rating: 5,
      moderationStatus: "APPROVED",
      verifiedPurchase: true,
    },
  });
  const r2 = await prisma.productReview.create({
    data: {
      productId,
      customerId: c2,
      rating: 3,
      moderationStatus: "APPROVED",
      verifiedPurchase: true,
    },
  });
  // Not yet moderated — must not count.
  const r3 = await prisma.productReview.create({
    data: {
      productId,
      customerId: c3,
      rating: 1,
      moderationStatus: "PENDING",
      verifiedPurchase: true,
    },
  });
  // Approved but never linked to a verified delivered order (e.g. a
  // MANUAL_OFFLINE entry) — must not count toward the verified average
  // even though a moderator approved it for display elsewhere.
  const r4 = await prisma.productReview.create({
    data: {
      productId,
      customerId: c4,
      rating: 5,
      moderationStatus: "APPROVED",
      verifiedPurchase: false,
    },
  });
  // Verified purchase but moderator rejected the content — must not count.
  const r5 = await prisma.productReview.create({
    data: {
      productId,
      customerId: c5,
      rating: 2,
      moderationStatus: "REJECTED",
      verifiedPurchase: true,
    },
  });
  reviewIds.push(r1.id, r2.id, r3.id, r4.id, r5.id);

  await recomputeProductRating(productId);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(product.ratingCount, 2);
  assert.equal(Number(product.ratingAverage), 4); // (5 + 3) / 2
});

test("hiding a previously-approved review drops it out of the recomputed average", async () => {
  await prisma.productReview.update({
    where: { id: reviewIds[0]! },
    data: { moderationStatus: "HIDDEN" },
  });
  await recomputeProductRating(productId);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(product.ratingCount, 1);
  assert.equal(Number(product.ratingAverage), 3);
});

test("one review per account per product is enforced at the database level", async () => {
  const c6 = await makeCustomer("duplicate-guard");
  const first = await prisma.productReview.create({
    data: {
      productId,
      customerId: c6,
      rating: 4,
      moderationStatus: "APPROVED",
      verifiedPurchase: true,
    },
  });
  reviewIds.push(first.id);
  await assert.rejects(() =>
    prisma.productReview.create({
      data: {
        productId,
        customerId: c6,
        rating: 2,
        moderationStatus: "PENDING",
        verifiedPurchase: false,
      },
    }),
  );
});

test("multiple MANUAL_OFFLINE reviews with no linked account never collide on the unique constraint", async () => {
  // Baseline from the DB itself (not a hard-coded number) — this test
  // only needs to prove the manual entries don't change the verified
  // aggregate, not what the exact prior count was.
  await recomputeProductRating(productId);
  const before = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

  const m1 = await prisma.productReview.create({
    data: {
      productId,
      customerId: null,
      manualCustomerName: "Call centre lead A",
      rating: 5,
      source: "MANUAL_OFFLINE",
      moderationStatus: "APPROVED",
      consentConfirmed: true,
    },
  });
  const m2 = await prisma.productReview.create({
    data: {
      productId,
      customerId: null,
      manualCustomerName: "Call centre lead B",
      rating: 4,
      source: "MANUAL_OFFLINE",
      moderationStatus: "APPROVED",
      consentConfirmed: true,
    },
  });
  reviewIds.push(m1.id, m2.id);

  // Manual reviews are approved but not verifiedPurchase — must not move
  // the verified-buyer aggregate at all.
  await recomputeProductRating(productId);
  const after = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(after.ratingCount, before.ratingCount);
  assert.equal(Number(after.ratingAverage), Number(before.ratingAverage));
});
