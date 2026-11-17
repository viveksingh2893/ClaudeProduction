/**
 * Integration test against the real dev Postgres (same connection
 * seed.ts / ratings.test.ts use) — creates and tears down its own
 * throwaway fixtures. Covers the eligibility gate (verified-purchase
 * checks) and the create/edit/one-per-account submission flow, which
 * ratings.test.ts deliberately does not exercise (it seeds ProductReview
 * rows directly and only tests aggregation).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  checkReviewEligibility,
  submitProductReview,
  getCustomerReviewForProduct,
} from "./reviews";

let sellerId: string;
let categoryId: string;
let productId: string;
const customerIds: string[] = [];
const checkoutGroupIds: string[] = [];

let customerCounter = 0;
async function makeCustomer(tag: string) {
  customerCounter += 1;
  const phoneSuffix = `${Date.now()}${customerCounter}`.slice(-9);
  const user = await prisma.user.create({
    data: {
      firstName: `TEST FIXTURE review customer ${tag}`,
      phone: `9${phoneSuffix}`,
      role: "CUSTOMER",
      referralCode: `TEST-REVIEW-${Date.now()}-${customerCounter}-${tag}`,
    },
  });
  customerIds.push(user.id);
  return user.id;
}

/** Builds one delivered-or-not SellerOrder with a single OrderItem for the fixture product, entirely through real relations (no shortcuts) so checkReviewEligibility's actual where-clause (status/customerId/refundStatus) is what's under test. */
async function makeOrder(
  customerId: string,
  status: "DELIVERED" | "CANCELLED" | "CONFIRMED",
  refundStatus: "NONE" | "REFUNDED" = "NONE",
) {
  const group = await prisma.checkoutGroup.create({
    data: {
      groupNumber: `TEST-GROUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      customerId,
      customerType: "CUSTOMER",
    },
  });
  checkoutGroupIds.push(group.id);
  const order = await prisma.sellerOrder.create({
    data: {
      orderNumber: `TEST-ORDER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      checkoutGroupId: group.id,
      customerId,
      sellerId,
      customerType: "CUSTOMER",
      status,
      paymentMethod: "COD",
      deliveryMethod: "KISAN4U_COURIER",
      subtotal: 100,
      totalAmount: 100,
      items: {
        create: {
          productId,
          productName: "TEST FIXTURE review product",
          productImageUrl: "/test/fixture.jpg",
          sku: "TEST-FIXTURE-REVIEW",
          quantity: 1,
          unit: "PIECE",
          unitWeightGrams: 100,
          totalWeightGrams: 100,
          mrp: 100,
          unitPrice: 100,
          subtotal: 100,
          refundStatus,
        },
      },
    },
  });
  return order.id;
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
      name: "TEST FIXTURE review product",
      slug: `test-fixture-review-${Date.now()}`,
      sku: `TEST-FIXTURE-REVIEW-${Date.now()}`,
      hsnCode: "000000",
      shortDescription: "Regression test fixture",
      description: "Regression test fixture for checkReviewEligibility/submitProductReview.",
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
  await prisma.orderItem.deleteMany({ where: { productId } });
  await prisma.sellerOrder.deleteMany({ where: { checkoutGroupId: { in: checkoutGroupIds } } });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: checkoutGroupIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: { in: customerIds } } });
});

test("a customer with no orders at all is not eligible to review (rejects non-buyers)", async () => {
  const customerId = await makeCustomer("non-buyer");
  const result = await checkReviewEligibility(customerId, productId);
  assert.equal(result.eligible, false);
});

test("a customer whose order was cancelled (never delivered) is not eligible", async () => {
  const customerId = await makeCustomer("cancelled-order");
  await makeOrder(customerId, "CANCELLED");
  const result = await checkReviewEligibility(customerId, productId);
  assert.equal(result.eligible, false);
});

test("a customer whose order is still in progress (confirmed, not yet delivered) is not eligible", async () => {
  const customerId = await makeCustomer("in-progress-order");
  await makeOrder(customerId, "CONFIRMED");
  const result = await checkReviewEligibility(customerId, productId);
  assert.equal(result.eligible, false);
});

test("a customer whose delivered item was fully refunded is not eligible", async () => {
  const customerId = await makeCustomer("refunded-order");
  await makeOrder(customerId, "DELIVERED", "REFUNDED");
  const result = await checkReviewEligibility(customerId, productId);
  assert.equal(result.eligible, false);
});

test("a customer with a delivered, non-refunded order containing the product is eligible", async () => {
  const customerId = await makeCustomer("eligible-buyer");
  await makeOrder(customerId, "DELIVERED");
  const result = await checkReviewEligibility(customerId, productId);
  assert.equal(result.eligible, true);
  assert.ok(!result.eligible || result.orderItemId);
});

test("submitProductReview rejects a non-buyer and creates no review row", async () => {
  const customerId = await makeCustomer("submit-non-buyer");
  const result = await submitProductReview(customerId, { productId, rating: 5, comment: "Great!" });
  assert.equal(result.ok, false);
  const stored = await getCustomerReviewForProduct(customerId, productId);
  assert.equal(stored, null);
});

test("submitProductReview creates a PENDING, verifiedPurchase review for an eligible buyer", async () => {
  const customerId = await makeCustomer("submit-eligible");
  await makeOrder(customerId, "DELIVERED");
  const result = await submitProductReview(customerId, {
    productId,
    rating: 4,
    comment: "Worked well.",
  });
  assert.equal(result.ok, true);
  const stored = await getCustomerReviewForProduct(customerId, productId);
  assert.ok(stored);
  assert.equal(stored?.verifiedPurchase, true);
  assert.equal(stored?.moderationStatus, "PENDING");
  assert.equal(stored?.rating, 4);
});

test("a second submission from the same account edits the existing review instead of duplicating it, and resets moderation to PENDING", async () => {
  const customerId = await makeCustomer("submit-edit");
  await makeOrder(customerId, "DELIVERED");
  const first = await submitProductReview(customerId, { productId, rating: 3, comment: "Okay." });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await prisma.productReview.update({
    where: { id: first.reviewId },
    data: { moderationStatus: "APPROVED" },
  });

  const second = await submitProductReview(customerId, {
    productId,
    rating: 5,
    comment: "Actually excellent after a week.",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reviewId, first.reviewId);

  const count = await prisma.productReview.count({ where: { customerId, productId } });
  assert.equal(count, 1);
  const stored = await getCustomerReviewForProduct(customerId, productId);
  assert.equal(stored?.rating, 5);
  assert.equal(stored?.moderationStatus, "PENDING");
});

test("submitProductReview rejects an out-of-range rating", async () => {
  const customerId = await makeCustomer("submit-bad-rating");
  await makeOrder(customerId, "DELIVERED");
  const result = await submitProductReview(customerId, { productId, rating: 6, comment: "x" });
  assert.equal(result.ok, false);
});
