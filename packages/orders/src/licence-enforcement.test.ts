/**
 * Selling-licence module addition: before this module, validateCartLine
 * only ever checked state/licence eligibility for the DEALER role —
 * CUSTOMER lines were never gated at all. This covers that closed gap
 * directly against validateCartLine (the single choke point both cart
 * mutation and checkout revalidation call through), plus confirms the
 * "customer state not yet known" skip behavior spec §13 calls for.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  createLicenceRequirement,
  createSellerLicenceSubmission,
  decideSellerLicenceSubmission,
} from "@kisan4u/catalog";
import { validateCartLine } from "./line-validation";

const RUN = Date.now();

let categoryId: string;
let stateAId: string;
let stateBId: string;
let sellerId: string;
let sellerUserId: string;
let adminUserId: string;
let productId: string;
let requirementId: string;

const createdUserIds: string[] = [];
const createdSellerProfileIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];
const createdRequirementIds: string[] = [];
const createdSubmissionIds: string[] = [];

before(async () => {
  // isActive: false — this suite doesn't exercise homepage "Shop by
  // Category" position ranking at all, and keeping the fixture out of the
  // active top-level set avoids racing category-hierarchy.test.ts's
  // global active-category re-ranking when test files run concurrently
  // (see that file's own doc comment on the same hazard).
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE licence enforcement ${RUN}`,
      slug: `test-fixture-licence-enforcement-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;
  createdCategoryIds.push(categoryId);

  const states = await prisma.indianState.findMany({ where: { isActive: true }, take: 2 });
  if (states.length < 2) throw new Error("Test requires at least 2 active IndianState rows.");
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `test-lic-enf-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE admin",
      role: "ADMIN",
      referralCode: `TEST-LIC-ENF-ADMIN-${RUN}`,
    },
  });
  adminUserId = adminUser.id;
  createdUserIds.push(adminUserId);

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-lic-enf-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE seller",
      role: "SELLER",
      referralCode: `TEST-LIC-ENF-SELLER-${RUN}`,
      sellerProfile: {
        create: {
          shopName: "Test Licence Enforcement Shop",
          slug: `test-lic-enf-shop-${RUN}`,
          status: "APPROVED",
        },
      },
    },
    include: { sellerProfile: true },
  });
  sellerUserId = sellerUser.id;
  sellerId = sellerUser.sellerProfile!.id;
  createdUserIds.push(sellerUserId);
  createdSellerProfileIds.push(sellerId);

  const product = await prisma.product.create({
    data: {
      sellerId,
      categoryId,
      name: "TEST FIXTURE customer-licensed product",
      slug: `test-fixture-customer-licensed-${RUN}`,
      sku: `TEST-CUST-LIC-${RUN}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for customer-side licence enforcement.",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      customerConfig: {
        create: { mrp: 100, sellingPrice: 100, minOrderQty: 1, currentStock: 50, weight: 200 },
      },
    },
  });
  productId = product.id;
  createdProductIds.push(productId);

  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Customer Licence",
      customerRequired: true,
      customerGeoType: "STATE_WISE",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  requirementId = req.requirementId;
  createdRequirementIds.push(requirementId);

  // The product itself must stay customerVisible (reconcileTaxonomyNodeCompliance
  // may have just restricted it since no submission exists yet at requirement-
  // creation time) — force it back on so this suite's cart-level assertions
  // aren't pre-empted by that unrelated restriction.
  await prisma.product.update({ where: { id: productId }, data: { customerVisible: true } });
});

after(async () => {
  await prisma.productComplianceReview.deleteMany({
    where: { productId: { in: createdProductIds } },
  });
  await prisma.sellerLicenceSubmission.deleteMany({ where: { id: { in: createdSubmissionIds } } });
  await prisma.licenceRequirement.deleteMany({ where: { id: { in: createdRequirementIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: createdSellerProfileIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
});

test("a customer line with no known delivery state is not gated by licence eligibility", async () => {
  const result = await validateCartLine(productId, null, 1, {
    role: "CUSTOMER",
    dealerStateId: null,
    customerStateId: null,
  });
  assert.equal(
    result.ok,
    true,
    "state/licence check is skipped entirely when the customer's state isn't known yet",
  );
});

test("a customer line is blocked when the seller has no approved licence for the customer's state", async () => {
  const result = await validateCartLine(productId, null, 1, {
    role: "CUSTOMER",
    dealerStateId: null,
    customerStateId: stateAId,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "LICENSE_MISSING");
});

test("a customer line succeeds once the seller has an approved licence covering that exact state", async () => {
  const submitted = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-CUST-001",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [stateAId],
      dealerStateIds: [],
      documentStorageKey: "test/cust-doc.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  createdSubmissionIds.push(submitted.submissionId);

  const approved = await decideSellerLicenceSubmission(
    submitted.submissionId,
    { action: "APPROVE" },
    { id: adminUserId },
  );
  assert.equal(approved.ok, true);

  const resultForLicensedState = await validateCartLine(productId, null, 1, {
    role: "CUSTOMER",
    dealerStateId: null,
    customerStateId: stateAId,
  });
  assert.equal(resultForLicensedState.ok, true);

  // The licence only covers stateA — a different state must still be
  // blocked (state-wise coverage is not Pan India). Expected code is
  // STATE_UNAVAILABLE, not LICENSE_MISSING: approving the stateA-only
  // licence now correctly restores product.customerAvailableStates to
  // the concrete [stateA] list (see packages/catalog/src/
  // licence-compliance.ts's bidirectional reconcile) rather than leaving
  // it empty/Pan-India-misread as it did before that fix — so
  // checkStateAndLicenceEligibility's state-configuration check (checked
  // first) now correctly catches stateB before ever reaching the
  // licence-eligibility check. LICENSE_MISSING is still reachable, just
  // not for this exact scenario (it fires when the *product's own*
  // configured states include the requested state but the seller's
  // licence for that state isn't approved yet).
  const resultForOtherState = await validateCartLine(productId, null, 1, {
    role: "CUSTOMER",
    dealerStateId: null,
    customerStateId: stateBId,
  });
  assert.equal(resultForOtherState.ok, false);
  if (resultForOtherState.ok) return;
  assert.equal(resultForOtherState.code, "STATE_UNAVAILABLE");
});

test("a dealer line for the same product/category is unaffected by a customer-only requirement", async () => {
  // This product is CUSTOMER_ONLY (dealerVisible: false by default at creation), so a dealer line is rejected for WRONG_AUDIENCE — not licence-related at all, confirming the customer-only requirement never leaks into dealer evaluation.
  const result = await validateCartLine(productId, null, 1, {
    role: "DEALER",
    dealerStateId: stateAId,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "WRONG_AUDIENCE");
});
