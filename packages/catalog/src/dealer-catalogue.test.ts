/**
 * Integration test for the dealer-catalogue bug: a dealer with no
 * normalized state (DealerProfile.stateId === null — true of every real
 * dealer who came through registration rather than seed data, since
 * nothing else ever set it) must still see nationwide products as
 * available; a state-restricted product must be present but flagged
 * unavailable; a dealer whose state matches must see both as available; a
 * customer-only product must never appear in dealer results regardless of
 * state. Requires the dev Postgres reachable (same connection seed.ts
 * uses) — creates and tears down its own throwaway fixtures so it doesn't
 * depend on or pollute seed data.
 *
 * Product Card Design Spec update: getDealerCatalogue used to filter out
 * state-unavailable products entirely — the unified ProductCard needs to
 * show them too (with a Request-Seller-only action), so it now returns
 * every dealer-eligible product with an `availableInState` flag instead of
 * omitting the unavailable ones (see queries.ts's doc comment).
 *
 * Variant-stock-management update: adaptDealerProduct now also checks
 * stock (previously it never did — a $0-stock product silently offered
 * BUY_AND_CART). currentStock is set explicitly on both fixtures below so
 * this file's own "should be purchasable" assertions stay true regardless
 * of the model's @default(0) — a fixture that actually wants to exercise
 * the out-of-stock path sets its own currentStock: 0 instead.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { getDealerCatalogue } from "./queries";
import { redactDealerPricingIfUnavailable } from "./availability";
import { adaptDealerProduct } from "./product-card-adapter";

let sellerId: string;
let categoryId: string;
let stateAId: string;
let stateBId: string;
let nationwideProductId: string;
let restrictedProductId: string;
let customerOnlyProductId: string;
let dealerNoStateUserId: string;
let dealerMatchingStateUserId: string;

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
  const states = await prisma.indianState.findMany({ take: 2 });
  if (states.length < 2) throw new Error("Test requires at least 2 seeded IndianState rows.");
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const baseProductData = {
    sellerId,
    categoryId,
    hsnCode: "000000",
    shortDescription: "Regression test fixture",
    description: "Regression test fixture for the dealer catalogue bug.",
    productType: "PHYSICAL" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
    lifecycleStatus: "APPROVED" as const,
  };

  const nationwide = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE nationwide dealer product",
      slug: `test-fixture-nationwide-${Date.now()}`,
      sku: `TEST-FIXTURE-NATIONWIDE-${Date.now()}`,
      audience: "DEALER_ONLY",
      dealerVisible: true,
      customerVisible: false,
      dealerConfig: { create: { mrp: 100, sellingPrice: 100, currentStock: 100 } },
    },
  });
  nationwideProductId = nationwide.id;

  const restricted = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE state-restricted dealer product",
      slug: `test-fixture-restricted-${Date.now()}`,
      sku: `TEST-FIXTURE-RESTRICTED-${Date.now()}`,
      audience: "DEALER_ONLY",
      dealerVisible: true,
      customerVisible: false,
      dealerConfig: { create: { mrp: 100, sellingPrice: 100, currentStock: 100 } },
      dealerAvailableStates: { connect: [{ id: stateAId }, { id: stateBId }] },
    },
  });
  restrictedProductId = restricted.id;

  const customerOnly = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE customer-only product",
      slug: `test-fixture-customer-only-${Date.now()}`,
      sku: `TEST-FIXTURE-CUSTOMERONLY-${Date.now()}`,
      audience: "CUSTOMER_ONLY",
      dealerVisible: false,
      customerVisible: true,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  customerOnlyProductId = customerOnly.id;

  const noStateDealer = await prisma.user.create({
    data: {
      phone: `+91900000${Date.now().toString().slice(-4)}`,
      firstName: "TEST FIXTURE dealer no state",
      role: "DEALER",
      referralCode: `TEST-NOSTATE-${Date.now()}`,
      dealerProfile: { create: { status: "APPROVED", storeName: "Test", stateId: null } },
    },
  });
  dealerNoStateUserId = noStateDealer.id;

  const matchingStateDealer = await prisma.user.create({
    data: {
      phone: `+91900001${Date.now().toString().slice(-4)}`,
      firstName: "TEST FIXTURE dealer matching state",
      role: "DEALER",
      referralCode: `TEST-MATCH-${Date.now()}`,
      dealerProfile: { create: { status: "APPROVED", storeName: "Test", stateId: stateAId } },
    },
  });
  dealerMatchingStateUserId = matchingStateDealer.id;
});

after(async () => {
  await prisma.dealerProfile.deleteMany({
    where: { userId: { in: [dealerNoStateUserId, dealerMatchingStateUserId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [dealerNoStateUserId, dealerMatchingStateUserId] } },
  });
  await prisma.productDealerConfig.deleteMany({
    where: { productId: { in: [nationwideProductId, restrictedProductId] } },
  });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: customerOnlyProductId } });
  await prisma.product.deleteMany({
    where: { id: { in: [nationwideProductId, restrictedProductId, customerOnlyProductId] } },
  });
});

test("a dealer with no normalized state sees nationwide products as available and state-restricted ones as unavailable (not omitted)", async () => {
  const products = await getDealerCatalogue(null);
  const nationwide = products.find((p) => p.id === nationwideProductId);
  const restricted = products.find((p) => p.id === restrictedProductId);
  assert.ok(nationwide, "nationwide product should be present");
  assert.equal(nationwide!.availableInState, true);
  assert.ok(
    restricted,
    "state-restricted product should be present, not omitted, for a dealer with no state",
  );
  assert.equal(restricted!.availableInState, false);
});

test("a dealer whose state matches the product's availableStates sees both as available", async () => {
  const products = await getDealerCatalogue(stateAId);
  const nationwide = products.find((p) => p.id === nationwideProductId);
  const restricted = products.find((p) => p.id === restrictedProductId);
  assert.equal(nationwide?.availableInState, true);
  assert.equal(
    restricted?.availableInState,
    true,
    "state-restricted product should be available to a matching-state dealer",
  );
});

test("a customer-only product never appears in dealer catalogue results", async () => {
  const asNoState = await getDealerCatalogue(null);
  const asMatching = await getDealerCatalogue(stateAId);
  assert.ok(!asNoState.map((p) => p.id).includes(customerOnlyProductId));
  assert.ok(!asMatching.map((p) => p.id).includes(customerOnlyProductId));
});

/**
 * Spec §7/§10 — a state-unavailable Dealer product must never leak price
 * (or any purchase capability) through either the server-rendered product
 * card or the raw JSON API path. These two functions are the two
 * independent enforcement points (see their own doc comments in
 * availability.ts / product-card-adapter.ts); test both so a regression in
 * either is caught even if the other still happens to hide it.
 */
test("a state-unavailable dealer product's price is never present in the product card adapter's output", async () => {
  const products = await getDealerCatalogue(null);
  const restricted = products.find((p) => p.id === restrictedProductId);
  assert.ok(restricted);
  assert.equal(restricted!.availableInState, false);

  const card = adaptDealerProduct(restricted!, { ratingThreshold: 0, wishlisted: false });
  assert.equal(card.pricing.kind, "DEALER_UNPRICED");
  assert.ok(
    !("mrp" in card.pricing),
    "no mrp field at all when the product is unavailable in-state",
  );
  assert.ok(
    !("sellingPrice" in card.pricing),
    "no sellingPrice field at all when the product is unavailable in-state",
  );
  assert.equal(
    card.purchase.kind,
    "REQUEST_SELLER_ONLY",
    "Add to Cart/Buy Now must never be offered",
  );
  assert.equal(card.badge?.text, "Unavailable in your state");
});

test("a state-available dealer product's price is present in the product card adapter's output", async () => {
  const products = await getDealerCatalogue(stateAId);
  const restricted = products.find((p) => p.id === restrictedProductId);
  assert.ok(restricted);
  assert.equal(restricted!.availableInState, true);

  const card = adaptDealerProduct(restricted!, { ratingThreshold: 0, wishlisted: false });
  assert.equal(card.pricing.kind, "DEALER_PRICED");
  assert.equal(card.purchase.kind, "BUY_AND_CART");
});

test("redactDealerPricingIfUnavailable nulls dealerConfig price fields only when unavailable, and passes through untouched otherwise", async () => {
  const unavailable = await getDealerCatalogue(null);
  const restrictedUnavailable = unavailable.find((p) => p.id === restrictedProductId);
  assert.ok(restrictedUnavailable);
  const redacted = redactDealerPricingIfUnavailable({ ...restrictedUnavailable!, variants: [] });
  assert.equal(redacted.dealerConfig?.mrp, null);
  assert.equal(redacted.dealerConfig?.sellingPrice, null);

  const available = await getDealerCatalogue(stateAId);
  const restrictedAvailable = available.find((p) => p.id === restrictedProductId);
  assert.ok(restrictedAvailable);
  const passthrough = redactDealerPricingIfUnavailable({ ...restrictedAvailable!, variants: [] });
  assert.notEqual(passthrough.dealerConfig?.mrp, null);
  assert.notEqual(passthrough.dealerConfig?.sellingPrice, null);
});
