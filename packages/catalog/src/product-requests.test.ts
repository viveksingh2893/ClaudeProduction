/**
 * Regression coverage for "Request This Product" (dealer enquiry, admin
 * approval gate, strict seller-side dealer anonymity). Creates and tears
 * down its own throwaway fixtures so it doesn't depend on or pollute seed
 * data.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  createProductRequest,
  getDealerRequestById,
  getSellerRequestById,
  getDealerRequests,
  getSellerRequests,
  getSellerRequestsPaginated,
  getAdminRequestById,
  approveProductRequest,
  rejectProductRequest,
  cancelProductRequestAsDealer,
} from "./product-requests";

let categoryId: string;
let stateAId: string; // the dealer's own verified state
let stateBId: string;
let sellerId: string;
let otherSellerId: string;
let dealerId: string;
let dealerUserId: string;
let otherDealerId: string;
let unavailableProductId: string; // APPROVED, restricted to stateB — unavailable in the dealer's own stateA
let availableProductId: string; // APPROVED, nationwide — already available in stateA
let hiddenProductId: string; // SUBMITTED, not yet approved, restricted to stateB
let customerOnlyProductId: string; // audience CUSTOMER_ONLY, restricted to stateB
let activeVariantId: string;
let inactiveVariantId: string;

const createdUserIds: string[] = [];
const createdDealerProfileIds: string[] = [];
const createdSellerProfileIds: string[] = [];
const createdProductIds: string[] = [];

before(async () => {
  // Excludes other suites' throwaway "TEST FIXTURE ..." categories — node:test
  // runs files concurrently, and an unfiltered query here can race with one
  // of those, picking up a category that suite deletes out from under this
  // product's foreign key before this suite's own cleanup runs.
  const category = await prisma.category.findFirstOrThrow({
    where: { name: { not: { startsWith: "TEST FIXTURE" } } },
  });
  categoryId = category.id;
  const states = await prisma.indianState.findMany({ where: { isActive: true }, take: 2 });
  if (states.length < 2) throw new Error("Test requires at least 2 active IndianState rows.");
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-request-seller-${Date.now()}@example.com`,
      firstName: "TEST FIXTURE seller",
      role: "SELLER",
      referralCode: `TEST-REQ-SELLER-${Date.now()}`,
      sellerProfile: {
        create: {
          shopName: "Test Fixture Shop",
          slug: `test-fixture-shop-${Date.now()}`,
          status: "APPROVED",
        },
      },
    },
    include: { sellerProfile: true },
  });
  createdUserIds.push(sellerUser.id);
  sellerId = sellerUser.sellerProfile!.id;
  createdSellerProfileIds.push(sellerId);

  const otherSellerUser = await prisma.user.create({
    data: {
      email: `test-request-other-seller-${Date.now()}@example.com`,
      firstName: "TEST FIXTURE other seller",
      role: "SELLER",
      referralCode: `TEST-REQ-OTHERSELLER-${Date.now()}`,
      sellerProfile: {
        create: {
          shopName: "Test Fixture Other Shop",
          slug: `test-fixture-other-shop-${Date.now()}`,
          status: "APPROVED",
        },
      },
    },
    include: { sellerProfile: true },
  });
  createdUserIds.push(otherSellerUser.id);
  otherSellerId = otherSellerUser.sellerProfile!.id;
  createdSellerProfileIds.push(otherSellerId);

  const dealerUser = await prisma.user.create({
    data: {
      phone: `+91900002${Date.now().toString().slice(-4)}`,
      firstName: "TEST FIXTURE dealer",
      role: "DEALER",
      referralCode: `TEST-REQ-DEALER-${Date.now()}`,
      dealerProfile: {
        create: { status: "APPROVED", storeName: "Anonymous Store Co", stateId: stateAId },
      },
    },
    include: { dealerProfile: true },
  });
  createdUserIds.push(dealerUser.id);
  dealerUserId = dealerUser.id;
  dealerId = dealerUser.dealerProfile!.id;
  createdDealerProfileIds.push(dealerId);

  const otherDealerUser = await prisma.user.create({
    data: {
      phone: `+91900003${Date.now().toString().slice(-4)}`,
      firstName: "TEST FIXTURE other dealer",
      role: "DEALER",
      referralCode: `TEST-REQ-OTHERDEALER-${Date.now()}`,
      dealerProfile: { create: { status: "APPROVED", storeName: "Test", stateId: stateAId } },
    },
    include: { dealerProfile: true },
  });
  createdUserIds.push(otherDealerUser.id);
  otherDealerId = otherDealerUser.dealerProfile!.id;
  createdDealerProfileIds.push(otherDealerId);

  const baseProductData = {
    sellerId,
    categoryId,
    hsnCode: "000000",
    shortDescription: "Regression test fixture",
    description: "Regression test fixture for the Request This Product feature.",
    productType: "PHYSICAL" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
  };

  const unavailable = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE state-unavailable dealer product",
      slug: `test-fixture-req-unavail-${Date.now()}`,
      sku: `TEST-FIXTURE-REQ-UNAVAIL-${Date.now()}`,
      audience: "DEALER_ONLY",
      dealerVisible: true,
      customerVisible: false,
      lifecycleStatus: "APPROVED",
      dealerConfig: { create: { mrp: 100, sellingPrice: 100 } },
      dealerAvailableStates: { connect: [{ id: stateBId }] },
      variants: {
        create: [
          {
            audience: "DEALER",
            sku: `TEST-REQ-VARIANT-ACTIVE-${Date.now()}`,
            combinationKey: "test-active",
            mrp: 100,
            sellingPrice: 100,
            isActive: true,
          },
          {
            audience: "DEALER",
            sku: `TEST-REQ-VARIANT-INACTIVE-${Date.now()}`,
            combinationKey: "test-inactive",
            mrp: 100,
            sellingPrice: 100,
            isActive: false,
          },
        ],
      },
    },
    include: { variants: true },
  });
  unavailableProductId = unavailable.id;
  createdProductIds.push(unavailableProductId);
  activeVariantId = unavailable.variants.find((v) => v.isActive)!.id;
  inactiveVariantId = unavailable.variants.find((v) => !v.isActive)!.id;

  const available = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE nationwide dealer product",
      slug: `test-fixture-req-avail-${Date.now()}`,
      sku: `TEST-FIXTURE-REQ-AVAIL-${Date.now()}`,
      audience: "DEALER_ONLY",
      dealerVisible: true,
      customerVisible: false,
      lifecycleStatus: "APPROVED",
      dealerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  availableProductId = available.id;
  createdProductIds.push(availableProductId);

  const hidden = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE unapproved dealer product",
      slug: `test-fixture-req-hidden-${Date.now()}`,
      sku: `TEST-FIXTURE-REQ-HIDDEN-${Date.now()}`,
      audience: "DEALER_ONLY",
      dealerVisible: true,
      customerVisible: false,
      lifecycleStatus: "SUBMITTED",
      dealerConfig: { create: { mrp: 100, sellingPrice: 100 } },
      dealerAvailableStates: { connect: [{ id: stateBId }] },
    },
  });
  hiddenProductId = hidden.id;
  createdProductIds.push(hiddenProductId);

  const customerOnly = await prisma.product.create({
    data: {
      ...baseProductData,
      name: "TEST FIXTURE customer-only product",
      slug: `test-fixture-req-customeronly-${Date.now()}`,
      sku: `TEST-FIXTURE-REQ-CUSTOMERONLY-${Date.now()}`,
      audience: "CUSTOMER_ONLY",
      dealerVisible: false,
      customerVisible: true,
      lifecycleStatus: "APPROVED",
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
      dealerAvailableStates: { connect: [{ id: stateBId }] },
    },
  });
  customerOnlyProductId = customerOnly.id;
  createdProductIds.push(customerOnlyProductId);
});

after(async () => {
  await prisma.sellerProductRequest.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productDealerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.dealerProfile.deleteMany({ where: { id: { in: createdDealerProfileIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: createdSellerProfileIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

test("a dealer can request a product unavailable in their own verified state", async () => {
  const result = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 5,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.publicRequestNumber, /^REQ-[A-Z0-9]{8}$/);
});

test("neededByDate is optional and, when supplied, is stored and surfaced to the seller after approval", async () => {
  const created = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
    neededByDate: "2026-12-25",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const dealerRow = await getDealerRequestById(dealerId, created.requestId);
  assert.equal(dealerRow?.neededByDate?.toISOString().slice(0, 10), "2026-12-25");

  await approveProductRequest({
    requestId: created.requestId,
    sellerVisibleSummary: "Needed by a specific date.",
  });
  const sellerRow = await getSellerRequestById(sellerId, created.requestId);
  assert.equal(sellerRow?.neededByDate?.toISOString().slice(0, 10), "2026-12-25");

  const withoutDate = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(withoutDate.ok, true);
  if (!withoutDate.ok) return;
  const withoutDateRow = await getDealerRequestById(dealerId, withoutDate.requestId);
  assert.equal(withoutDateRow?.neededByDate, null);
});

test("a dealer cannot request a product already available in their own state", async () => {
  const result = await createProductRequest(dealerId, {
    productId: availableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(result.ok, false);
});

test("a dealer cannot request a product that isn't approved yet", async () => {
  const result = await createProductRequest(dealerId, {
    productId: hiddenProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(result.ok, false);
});

test("a dealer cannot request a product not configured for dealers", async () => {
  const result = await createProductRequest(dealerId, {
    productId: customerOnlyProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(result.ok, false);
});

test("a dealer cannot request an inactive variant", async () => {
  const result = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    variantId: inactiveVariantId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(result.ok, false);
});

test("a dealer can request a specific active variant", async () => {
  const result = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    variantId: activeVariantId,
    quantity: 2,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(result.ok, true);
});

test("submitting a request never modifies the dealer's own profile address/state", async () => {
  const before = await prisma.dealerProfile.findUniqueOrThrow({ where: { id: dealerId } });
  await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "A completely different one-off address",
  });
  const afterProfile = await prisma.dealerProfile.findUniqueOrThrow({ where: { id: dealerId } });
  assert.equal(afterProfile.stateId, before.stateId);
  assert.equal(afterProfile.storeAddress, before.storeAddress);
});

test("creating a request never touches SellerOrder — it is an enquiry only", async () => {
  const ordersBefore = await prisma.sellerOrder.count({ where: { customerId: dealerUserId } });
  await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  const ordersAfter = await prisma.sellerOrder.count({ where: { customerId: dealerUserId } });
  assert.equal(ordersAfter, ordersBefore);
});

test("a dealer sees only their own requests; a seller does not see a pending (unapproved) request", async () => {
  const created = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
    note: "Please deliver ASAP, my exact address is 42 Secret Lane",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const ownDealerRequests = await getDealerRequests(dealerId);
  const otherDealerRequests = await getDealerRequests(otherDealerId);
  assert.ok(ownDealerRequests.some((r) => r.id === created.requestId));
  assert.equal(otherDealerRequests.length, 0);

  // PENDING — not yet admin-approved, must be invisible to the seller entirely.
  const sellerView = await getSellerRequestById(sellerId, created.requestId);
  assert.equal(sellerView, null);
  const sellerList = await getSellerRequests(sellerId);
  assert.ok(!sellerList.some((r) => r.id === created.requestId));

  const asOtherDealer = await getDealerRequestById(otherDealerId, created.requestId);
  assert.equal(asOtherDealer, null);
});

test("admin approval forwards the request to the seller with no dealer PII and no raw note", async () => {
  const created = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 3,
    deliveryAddress: "42 Secret Lane, Somewhere",
    note: "My shop's GST number is ABC123 and my phone is 9999999999",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const approval = await approveProductRequest({
    requestId: created.requestId,
    sellerVisibleSummary:
      "Dealer needs 3 units delivered to a state we don't currently ship this product to.",
  });
  assert.equal(approval.ok, true);

  // Approving twice must fail — only a PENDING request can be approved.
  const secondApproval = await approveProductRequest({
    requestId: created.requestId,
    sellerVisibleSummary: "Second attempt.",
  });
  assert.equal(secondApproval.ok, false);

  const sellerRow = await getSellerRequestById(sellerId, created.requestId);
  assert.ok(sellerRow);
  assert.equal((sellerRow as unknown as Record<string, unknown>)["dealer"], undefined);
  assert.equal((sellerRow as unknown as Record<string, unknown>)["note"], undefined);
  assert.equal((sellerRow as unknown as Record<string, unknown>)["deliveryAddress"], undefined);
  assert.equal((sellerRow as unknown as Record<string, unknown>)["adminNotes"], undefined);
  assert.equal(
    sellerRow?.sellerVisibleSummary,
    "Dealer needs 3 units delivered to a state we don't currently ship this product to.",
  );
  assert.equal(sellerRow?.publicRequestNumber, created.publicRequestNumber);

  const sellerList = await getSellerRequests(sellerId);
  const sellerListRow = sellerList.find((r) => r.id === created.requestId) as unknown as
    Record<string, unknown> | undefined;
  assert.ok(sellerListRow);
  assert.equal(sellerListRow!["dealer"], undefined);
  assert.equal(sellerListRow!["note"], undefined);

  const otherSellerRow = await getSellerRequestById(otherSellerId, created.requestId);
  assert.equal(otherSellerRow, null);

  // Admin/dealer views still carry full detail.
  const adminRow = await getAdminRequestById(created.requestId);
  assert.equal(adminRow?.dealer.storeName, "Anonymous Store Co");
  assert.equal(adminRow?.note, "My shop's GST number is ABC123 and my phone is 9999999999");
  const dealerRow = await getDealerRequestById(dealerId, created.requestId);
  assert.equal(dealerRow?.status, "APPROVED");
});

test("a rejected request is never visible to the seller and shows the reason to the dealer", async () => {
  const created = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const rejection = await rejectProductRequest({
    requestId: created.requestId,
    rejectionReason: "Duplicate of an existing enquiry.",
  });
  assert.equal(rejection.ok, true);

  const sellerRow = await getSellerRequestById(sellerId, created.requestId);
  assert.equal(sellerRow, null);
  const sellerList = await getSellerRequests(sellerId);
  assert.ok(!sellerList.some((r) => r.id === created.requestId));

  const dealerRow = await getDealerRequestById(dealerId, created.requestId);
  assert.equal(dealerRow?.status, "REJECTED");
  assert.equal(dealerRow?.rejectionReason, "Duplicate of an existing enquiry.");

  // Rejecting an already-rejected request must fail.
  const secondRejection = await rejectProductRequest({
    requestId: created.requestId,
    rejectionReason: "again",
  });
  assert.equal(secondRejection.ok, false);
});

test("a seller-supplied status filter cannot smuggle in PENDING/REJECTED rows", async () => {
  const created = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const paginatedPending = await getSellerRequestsPaginated(sellerId, { status: "PENDING" });
  assert.equal(paginatedPending.total, 0);
  const paginatedRejected = await getSellerRequestsPaginated(sellerId, { status: "REJECTED" });
  assert.equal(paginatedRejected.total, 0);
});

test("dealer cancellation is allowed before CLOSED/REJECTED/CANCELLED, and blocked after", async () => {
  const created = await createProductRequest(dealerId, {
    productId: unavailableProductId,
    quantity: 1,
    deliveryAddress: "1 Test Street",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const cancelled = await cancelProductRequestAsDealer(dealerId, created.requestId);
  assert.equal(cancelled.ok, true);

  const secondCancel = await cancelProductRequestAsDealer(dealerId, created.requestId);
  assert.equal(secondCancel.ok, false);

  const asOtherDealer = await cancelProductRequestAsDealer(otherDealerId, created.requestId);
  assert.equal(asOtherDealer.ok, false);
});
