/**
 * Integration tests against the real dev Postgres — creates its own
 * throwaway fixtures (unique slugs/emails via Date.now()), same
 * convention as phase4-security.test.ts. Covers the specific corrective
 * requirements around dealer add-to-cart: the exact minimum-quantity
 * message, the machine-readable reason `code` (which the dealer
 * product-detail page uses to decide Add to Cart vs. Request Seller vs. a
 * specific reason — see apps/web/src/app/dealer/products/[id]/page.tsx),
 * and that an eligible dealer can add a product at or above the minimum.
 * The broader negative-path matrix (customer-only, wrong state, inactive
 * variant, unapproved product) is already covered by
 * phase4-security.test.ts — this file does not duplicate those, only adds
 * the `code` and minimum-quantity-message assertions that file predates.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { validateCartLine } from "./line-validation";

const RUN = Date.now();

let sellerId: string;
let stateId: string;
let productId: string; // DEALER_ONLY, minOrderQty 10, restricted to stateId
let dealerUserId: string;
let dealerProfileId: string;

const cleanupUserIds: string[] = [];

before(async () => {
  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  stateId = state.id;
  const category = await prisma.category.findFirstOrThrow();

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-minqty-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTMQS${RUN}`,
    },
  });
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test MinQty Shop ${RUN}`,
      slug: `test-minqty-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;
  cleanupUserIds.push(sellerUser.id);

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test MinQty Product ${RUN}`,
      slug: `test-minqty-product-${RUN}`,
      sku: `TEST-MINQTY-${RUN}`,
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
        create: { mrp: 500, sellingPrice: 500, minOrderQty: 10, currentStock: 100, weight: 1000 },
      },
    },
  });
  productId = product.id;

  const dealerUser = await prisma.user.create({
    data: {
      phone: `+91900${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Dealer",
      role: "DEALER",
      referralCode: `TESTMQD${RUN}`,
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
  await prisma.cartItem.deleteMany({ where: { userId: dealerUserId } });
  await prisma.dealerProfile.delete({ where: { id: dealerProfileId } }).catch(() => {});
  await prisma.productDealerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("quantity below the configured minimum is rejected with the exact suggested message and BELOW_MIN_QTY code", async () => {
  const result = await validateCartLine(productId, null, 5, {
    role: "DEALER",
    dealerStateId: stateId,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "BELOW_MIN_QTY");
  assert.equal(result.error, "Minimum order quantity for this product is 10.");
});

test("quantity at exactly the minimum succeeds", async () => {
  const result = await validateCartLine(productId, null, 10, {
    role: "DEALER",
    dealerStateId: stateId,
  });
  assert.equal(result.ok, true);
});

test("an approved dealer can add an eligible product to the cart at the minimum quantity", async () => {
  const result = await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 10 },
  );
  assert.equal(result.ok, true);
});

test("a state-unavailable product fails with STATE_UNAVAILABLE — the only code that should ever show Request Seller", async () => {
  const otherState = await prisma.indianState.findFirstOrThrow({
    where: { isActive: true, id: { not: stateId } },
  });
  const result = await validateCartLine(productId, null, 10, {
    role: "DEALER",
    dealerStateId: otherState.id,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "STATE_UNAVAILABLE");
});

test("an inactive/unapproved product fails with PRODUCT_UNAVAILABLE, never STATE_UNAVAILABLE — must not offer Request Seller", async () => {
  await prisma.product.update({ where: { id: productId }, data: { lifecycleStatus: "SUSPENDED" } });
  try {
    const result = await validateCartLine(productId, null, 10, {
      role: "DEALER",
      dealerStateId: stateId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "PRODUCT_UNAVAILABLE");
  } finally {
    await prisma.product.update({
      where: { id: productId },
      data: { lifecycleStatus: "APPROVED" },
    });
  }
});

test("out-of-stock fails with OUT_OF_STOCK, never STATE_UNAVAILABLE — must not offer Request Seller", async () => {
  await prisma.productDealerConfig.update({ where: { productId }, data: { currentStock: 0 } });
  try {
    const result = await validateCartLine(productId, null, 10, {
      role: "DEALER",
      dealerStateId: stateId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "OUT_OF_STOCK");
  } finally {
    await prisma.productDealerConfig.update({ where: { productId }, data: { currentStock: 100 } });
  }
});

// A PENDING/REJECTED/SUSPENDED dealer profile is gated before any
// @kisan4u/orders function is ever reached — enforced by
// apps/web/src/lib/buyer-context.ts (requireBuyerContext) and
// apps/web/src/lib/dealer.ts (requireApprovedDealerProfile), which
// redirect to /dealer/status. That's Next.js server-action/page routing,
// not something a package-level node:test can exercise without a running
// server — it's covered instead by manual browser testing (see the final
// report's manual-testing section: "pending dealer cannot add or checkout
// where approval is required").
