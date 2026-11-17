/**
 * Regression coverage for the bidirectional reconcile fix in
 * licence-compliance.ts — the root cause of "an approved licence never
 * makes the product visible again" (spec §8). Before this fix,
 * reconcileProductLicenceCompliance only ever narrowed (restricted)
 * customerVisible/dealerVisible; a fully-blocked audience had no path back
 * to true even after the seller's licence was approved. It also covers
 * the "empty states list misread as Pan India" defect that surfaced while
 * fixing the above: a state-wise audience being restored from a fully
 * blocked state must never end up with an empty states list, since an
 * empty list is the established "Pan India" convention everywhere else
 * (product-submission.ts, catalogue queries) — only a genuinely
 * Pan-India-eligible audience may be restored empty.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { createLicenceRequirement } from "./licence-requirements";
import {
  createSellerLicenceSubmission,
  decideSellerLicenceSubmission,
} from "./licence-submissions";

let stateAId: string;
let stateBId: string;
let adminUserId: string;
let sellerId: string;
let sellerUserId: string;

const createdUserIds: string[] = [];
const createdSellerProfileIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];
const createdRequirementIds: string[] = [];
const createdSubmissionIds: string[] = [];

before(async () => {
  const stamp = Date.now();
  const states = await prisma.indianState.findMany({ where: { isActive: true }, take: 2 });
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const admin = await prisma.user.create({
    data: {
      email: `test-compliance-admin-${stamp}@example.com`,
      firstName: "TEST FIXTURE compliance admin",
      role: "ADMIN",
      referralCode: `TEST-COMPLIANCE-ADMIN-${stamp}`,
    },
  });
  adminUserId = admin.id;
  createdUserIds.push(adminUserId);

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-compliance-seller-${stamp}@example.com`,
      firstName: "TEST FIXTURE compliance seller",
      role: "SELLER",
      referralCode: `TEST-COMPLIANCE-SELLER-${stamp}`,
      sellerProfile: {
        create: {
          shopName: "Test Compliance Shop",
          slug: `test-compliance-shop-${stamp}`,
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
});

after(async () => {
  await prisma.productComplianceReview.deleteMany({
    where: { productId: { in: createdProductIds } },
  });
  await prisma.sellerLicenceSubmission.deleteMany({ where: { id: { in: createdSubmissionIds } } });
  await prisma.licenceRequirement.deleteMany({ where: { id: { in: createdRequirementIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productDealerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: createdSellerProfileIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
});

async function createIsolatedCategoryAndProduct(label: string) {
  const stamp = Date.now();
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE ${label} ${stamp}`,
      slug: `test-fixture-${label.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      isActive: false,
    },
  });
  createdCategoryIds.push(category.id);
  const product = await prisma.product.create({
    data: {
      sellerId,
      categoryId: category.id,
      name: `TEST FIXTURE ${label} product`,
      slug: `test-fixture-${label.toLowerCase().replace(/\s+/g, "-")}-product-${stamp}`,
      sku: `TEST-${label.toUpperCase().replace(/\s+/g, "-")}-${stamp}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for licence compliance reconcile tests.",
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: true,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
      dealerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  createdProductIds.push(product.id);
  return { categoryId: category.id, productId: product.id };
}

test("a fully-blocked STATE_WISE audience is restored with the exact approved state, never left empty", async () => {
  const { categoryId, productId } = await createIsolatedCategoryAndProduct("statewise restore");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Compliance Statewise",
      customerRequired: true,
      customerGeoType: "STATE_WISE",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  if (!req.ok) return;
  createdRequirementIds.push(req.requirementId);

  // Requirement creation reconciles immediately — with no submission yet,
  // Customer coverage is fully non-compliant, so customerVisible must flip
  // to false (never left "on" with a stale empty/nationwide states list).
  const blocked = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { customerVisible: true },
  });
  assert.equal(
    blocked.customerVisible,
    false,
    "product is restricted once a new blocking requirement applies",
  );

  const submitted = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-COMPLIANCE-001",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [stateAId],
      dealerStateIds: [],
      documentStorageKey: "test/compliance1.pdf",
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

  const restored = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { customerVisible: true, customerAvailableStates: { select: { id: true } } },
  });
  assert.equal(
    restored.customerVisible,
    true,
    "approval must restore visibility for the now-compliant audience",
  );
  assert.deepEqual(
    restored.customerAvailableStates.map((s) => s.id).sort(),
    [stateAId],
    "restored states must be the exact approved state — an empty list here would be misread as Pan India everywhere else in the app",
  );

  const review = await prisma.productComplianceReview.findFirst({
    where: { productId, requirementId: req.requirementId },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(review);
  assert.equal(
    review!.status,
    "RESOLVED",
    "the compliance review opened by the block must be auto-resolved on restore",
  );
});

test("a fully-blocked PAN_INDIA audience is restored with an empty (nationwide) states list", async () => {
  const { categoryId, productId } = await createIsolatedCategoryAndProduct("panindia restore");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Compliance Pan India",
      customerRequired: false,
      dealerRequired: true,
      dealerGeoType: "PAN_INDIA",
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  if (!req.ok) return;
  createdRequirementIds.push(req.requirementId);

  const blocked = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { dealerVisible: true },
  });
  assert.equal(blocked.dealerVisible, false);

  const submitted = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "DEALER",
      licenceNumber: "LIC-COMPLIANCE-002",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/compliance2.pdf",
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

  const restored = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { dealerVisible: true, dealerAvailableStates: { select: { id: true } } },
  });
  assert.equal(restored.dealerVisible, true);
  assert.equal(
    restored.dealerAvailableStates.length,
    0,
    "a genuinely Pan-India-eligible restore must leave the states list empty",
  );
});

test("approving a CUSTOMER-only submission never restores or otherwise touches Dealer eligibility, and vice versa", async () => {
  const { categoryId, productId } = await createIsolatedCategoryAndProduct("audience isolation");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Compliance Audience Isolation",
      customerRequired: true,
      customerGeoType: "STATE_WISE",
      dealerRequired: true,
      dealerGeoType: "STATE_WISE",
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  if (!req.ok) return;
  createdRequirementIds.push(req.requirementId);

  const beforeAnySubmission = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { customerVisible: true, dealerVisible: true },
  });
  assert.equal(
    beforeAnySubmission.customerVisible,
    false,
    "both audiences start blocked — Customer leg unsatisfied",
  );
  assert.equal(
    beforeAnySubmission.dealerVisible,
    false,
    "both audiences start blocked — Dealer leg unsatisfied",
  );

  const customerSubmission = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-ISOLATION-CUSTOMER",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [stateAId],
      dealerStateIds: [],
      documentStorageKey: "test/isolation-customer.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(customerSubmission.ok, true);
  if (!customerSubmission.ok) return;
  createdSubmissionIds.push(customerSubmission.submissionId);

  // A submission being merely PENDING_APPROVAL must never itself trigger
  // any reconcile side effect — only decideSellerLicenceSubmission does.
  const stillBlockedWhilePending = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { customerVisible: true, dealerVisible: true },
  });
  assert.equal(
    stillBlockedWhilePending.customerVisible,
    false,
    "a pending submission grants nothing",
  );
  assert.equal(
    stillBlockedWhilePending.dealerVisible,
    false,
    "a pending submission grants nothing",
  );

  const approved = await decideSellerLicenceSubmission(
    customerSubmission.submissionId,
    { action: "APPROVE" },
    { id: adminUserId },
  );
  assert.equal(approved.ok, true);

  const afterCustomerApproval = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { customerVisible: true, dealerVisible: true },
  });
  assert.equal(afterCustomerApproval.customerVisible, true, "the approved audience is restored");
  assert.equal(
    afterCustomerApproval.dealerVisible,
    false,
    "approving a Customer-only submission must never restore Dealer eligibility",
  );
});

test("rejecting a submission does not restore a still-blocked audience", async () => {
  const { categoryId, productId } =
    await createIsolatedCategoryAndProduct("rejection stays blocked");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Compliance Rejection",
      customerRequired: true,
      customerGeoType: "STATE_WISE",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  if (!req.ok) return;
  createdRequirementIds.push(req.requirementId);

  const submitted = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-COMPLIANCE-003",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [stateBId],
      dealerStateIds: [],
      documentStorageKey: "test/compliance3.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  createdSubmissionIds.push(submitted.submissionId);

  const rejected = await decideSellerLicenceSubmission(
    submitted.submissionId,
    { action: "REJECT", reason: "Illegible document" },
    { id: adminUserId },
  );
  assert.equal(rejected.ok, true);

  const stillBlocked = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { customerVisible: true },
  });
  assert.equal(stillBlocked.customerVisible, false, "a rejection must never restore visibility");
});
