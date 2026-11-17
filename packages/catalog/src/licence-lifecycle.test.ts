/**
 * Database-backed integration coverage for the selling-licence module's
 * requirement/submission lifecycle and compliance reconciliation — the
 * parts that genuinely need real rows (versioning, revision chains,
 * expiry-at-read-time, product restriction side effects). Pure
 * hierarchy/AND-logic/geography coverage lives in
 * licence-eligibility.test.ts and needs no database.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  createLicenceRequirement,
  reviseLicenceRequirement,
  getTaxonomyNodeLicenceRequirements,
  deleteLicenceRequirement,
} from "./licence-requirements";
import {
  createSellerLicenceSubmission,
  resubmitSellerLicenceSubmission,
  decideSellerLicenceSubmission,
  deleteSellerLicenceSubmission,
} from "./licence-submissions";
import {
  buildSellerLicenceEligibilityIndex,
  evaluateEligibilityForPath,
} from "./licence-eligibility";
import { sweepExpiredLicenceSubmissions } from "./licence-compliance";

let categoryId: string;
let stateAId: string;
let adminUserId: string;
let sellerId: string;
let sellerUserId: string;
let productId: string;

const createdUserIds: string[] = [];
const createdSellerProfileIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];
const createdRequirementIds: string[] = [];
const createdSubmissionIds: string[] = [];

before(async () => {
  const stamp = Date.now();
  const category = await prisma.category.create({
    // isActive: false — keeps this fixture out of the active top-level
    // Category set so it can't race category-hierarchy.test.ts's global
    // active-category re-ranking under concurrent test-file execution
    // (see that file's own doc comment on the same hazard).
    data: {
      name: `TEST FIXTURE Licence Cat ${stamp}`,
      slug: `test-fixture-licence-cat-${stamp}`,
      isActive: false,
    },
  });
  categoryId = category.id;
  createdCategoryIds.push(categoryId);

  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  stateAId = state.id;

  const admin = await prisma.user.create({
    data: {
      email: `test-licence-admin-${stamp}@example.com`,
      firstName: "TEST FIXTURE admin",
      role: "ADMIN",
      referralCode: `TEST-LIC-ADMIN-${stamp}`,
    },
  });
  adminUserId = admin.id;
  createdUserIds.push(adminUserId);

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-licence-seller-${stamp}@example.com`,
      firstName: "TEST FIXTURE licence seller",
      role: "SELLER",
      referralCode: `TEST-LIC-SELLER-${stamp}`,
      sellerProfile: {
        create: {
          shopName: "Test Licence Shop",
          slug: `test-licence-shop-${stamp}`,
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
      name: "TEST FIXTURE licensed product",
      slug: `test-fixture-licensed-product-${stamp}`,
      sku: `TEST-LIC-PRODUCT-${stamp}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for licence lifecycle tests.",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  productId = product.id;
  createdProductIds.push(productId);
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
  await prisma.notification.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
});

test("creating a requirement makes it appear as a direct, active requirement on the node", async () => {
  const result = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Licence A",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdRequirementIds.push(result.requirementId);

  const { direct } = await getTaxonomyNodeLicenceRequirements("CATEGORY", categoryId);
  const found = direct.find((r) => r.id === result.requirementId);
  assert.ok(found);
  assert.equal(found!.isActive, true);
  assert.equal(found!.version, 1);
});

test("a material revision creates a new version and preserves the old one", async () => {
  const created = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Licence B",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  createdRequirementIds.push(created.requirementId);

  const revised = await reviseLicenceRequirement(
    created.requirementId,
    { customerGeoType: "STATE_WISE" },
    "Switched to state-wise coverage",
    { id: adminUserId },
  );
  assert.equal(revised.ok, true);
  if (!revised.ok) return;
  createdRequirementIds.push(revised.requirementId);
  assert.notEqual(revised.requirementId, created.requirementId);

  const oldRow = await prisma.licenceRequirement.findUniqueOrThrow({
    where: { id: created.requirementId },
  });
  const newRow = await prisma.licenceRequirement.findUniqueOrThrow({
    where: { id: revised.requirementId },
  });
  assert.equal(newRow.version, 2);
  assert.equal(newRow.previousVersionId, created.requirementId);
  assert.equal(newRow.customerGeoType, "STATE_WISE");
  assert.equal(
    oldRow.customerGeoType,
    "PAN_INDIA",
    "old version's own fields are never mutated by a revision",
  );

  const { direct } = await getTaxonomyNodeLicenceRequirements("CATEGORY", categoryId);
  assert.ok(
    !direct.some((r) => r.id === created.requirementId),
    "superseded version is no longer the current head",
  );
  assert.ok(direct.some((r) => r.id === revised.requirementId));
});

test("a state-wise submission is rejected server-side unless it names exactly one state", async () => {
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Licence Exactly One State",
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

  const otherState = await prisma.indianState.findFirstOrThrow({
    where: { isActive: true, id: { not: stateAId } },
  });

  const zeroStates = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-ZERO",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/zero.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(zeroStates.ok, false, "a state-wise requirement must reject zero states");

  const twoStates = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-TWO",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      // A manually-modified request payload attempting to smuggle in two
      // states for a leg that must cover exactly one — insertSubmission
      // must reject this regardless of what the client sent.
      customerStateIds: [stateAId, otherState.id],
      dealerStateIds: [],
      documentStorageKey: "test/two.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(twoStates.ok, false, "a state-wise requirement must reject more than one state");

  const oneState = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-ONE",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [stateAId],
      dealerStateIds: [],
      documentStorageKey: "test/one.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(oneState.ok, true, "exactly one state must be accepted");
  if (oneState.ok) createdSubmissionIds.push(oneState.submissionId);
});

test("a Pan India submission is rejected server-side if any state is attached", async () => {
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Licence Pan India No States",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  if (!req.ok) return;
  createdRequirementIds.push(req.requirementId);

  const withState = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-PANINDIA-STATE",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      // A Pan India leg must never accept a state, even one that's
      // otherwise valid — insertSubmission must reject this server-side
      // regardless of what the client sent.
      customerStateIds: [stateAId],
      dealerStateIds: [],
      documentStorageKey: "test/panindia-state.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(withState.ok, false, "a Pan India requirement must reject any submitted state");
});

test("resubmission after rejection creates a new revision, preserving the original", async () => {
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: categoryId,
      name: "Test Licence C",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
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
      licenceNumber: "LIC-001",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc1.pdf",
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
    { action: "REJECT", reason: "Document illegible" },
    { id: adminUserId },
  );
  assert.equal(rejected.ok, true);

  const resubmitted = await resubmitSellerLicenceSubmission(
    sellerId,
    submitted.submissionId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-001-B",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc2.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(resubmitted.ok, true);
  if (!resubmitted.ok) return;
  createdSubmissionIds.push(resubmitted.submissionId);

  const originalRow = await prisma.sellerLicenceSubmission.findUniqueOrThrow({
    where: { id: submitted.submissionId },
  });
  assert.equal(
    originalRow.status,
    "REJECTED",
    "original row's history is preserved, not overwritten",
  );
  const newRow = await prisma.sellerLicenceSubmission.findUniqueOrThrow({
    where: { id: resubmitted.submissionId },
  });
  assert.equal(newRow.previousRevisionId, submitted.submissionId);
  assert.equal(newRow.status, "PENDING_APPROVAL");

  // A second resubmission attempt on the now-superseded original must fail.
  const doubleResubmit = await resubmitSellerLicenceSubmission(
    sellerId,
    submitted.submissionId,
    {
      requirementId: req.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-001-C",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc3.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(doubleResubmit.ok, false);
});

/** Tests 1-3 above deliberately share `categoryId` and stack up requirements (A, B, C) on it — fine for their own assertions, but AND-logic means every requirement on that node applies cumulatively to any product under it. The expiry/sweep tests need to assert on ONE specific requirement's blocking status and on a product's restriction outcome in isolation, so they get their own dedicated category + product instead of reusing the shared one. */
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
      description: "Regression fixture for licence lifecycle tests.",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  createdProductIds.push(product.id);
  return { categoryId: category.id, productId: product.id };
}

test("expiry is enforced at read time even before any sweep updates the stored status", async () => {
  const { categoryId: isolatedCategoryId } =
    await createIsolatedCategoryAndProduct("expiry read time");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: isolatedCategoryId,
      name: "Test Licence D",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
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
      licenceNumber: "LIC-002",
      expiryDate: new Date(Date.now() + 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc4.pdf",
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

  // Force the expiry into the past directly (simulating time passing) —
  // stored status stays APPROVED, exactly as it would after real expiry
  // and before any sweep has run.
  await prisma.sellerLicenceSubmission.update({
    where: { id: submitted.submissionId },
    data: { expiryDate: new Date(Date.now() - 1000) },
  });
  const stillStoredAsApproved = await prisma.sellerLicenceSubmission.findUniqueOrThrow({
    where: { id: submitted.submissionId },
  });
  assert.equal(stillStoredAsApproved.status, "APPROVED");

  const index = await buildSellerLicenceEligibilityIndex(sellerId);
  const eligibility = evaluateEligibilityForPath(index, { categoryId: isolatedCategoryId });
  assert.equal(
    eligibility.customer.eligibleStateIds.length,
    0,
    "expired-but-not-yet-swept licence must not count as valid",
  );
  assert.equal(eligibility.customer.blockingRequirements[0]!.status, "EXPIRED");
});

test("sweepExpiredLicenceSubmissions physically flips status and restricts the affected product without touching unaffected data", async () => {
  const { categoryId: isolatedCategoryId, productId: isolatedProductId } =
    await createIsolatedCategoryAndProduct("sweep");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: isolatedCategoryId,
      name: "Test Licence E",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
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
      licenceNumber: "LIC-003",
      expiryDate: new Date(Date.now() + 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc5.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  createdSubmissionIds.push(submitted.submissionId);
  await decideSellerLicenceSubmission(
    submitted.submissionId,
    { action: "APPROVE" },
    { id: adminUserId },
  );
  await prisma.sellerLicenceSubmission.update({
    where: { id: submitted.submissionId },
    data: { expiryDate: new Date(Date.now() - 1000) },
  });

  // Approval above already restored customerVisible via the bidirectional
  // reconcile in licence-compliance.ts (see reconcileProductLicenceCompliance's
  // doc comment, and licence-compliance.test.ts for dedicated restore
  // coverage) — this explicit set is redundant with that, kept only to
  // make this test's precondition self-evident without depending on
  // reading through the reconcile call chain.
  await prisma.product.update({ where: { id: isolatedProductId }, data: { customerVisible: true } });
  const beforeSweep = await prisma.product.findUniqueOrThrow({
    where: { id: isolatedProductId },
    select: { customerVisible: true },
  });
  assert.equal(beforeSweep.customerVisible, true);

  await sweepExpiredLicenceSubmissions();

  const submissionAfter = await prisma.sellerLicenceSubmission.findUniqueOrThrow({
    where: { id: submitted.submissionId },
  });
  assert.equal(submissionAfter.status, "EXPIRED");

  const productAfter = await prisma.product.findUniqueOrThrow({
    where: { id: isolatedProductId },
    select: { customerVisible: true, dealerVisible: true },
  });
  assert.equal(
    productAfter.customerVisible,
    false,
    "fully blocked audience is restricted via customerVisible, never by silently reinterpreting an empty state list",
  );
  assert.equal(
    productAfter.dealerVisible,
    true,
    "an unrelated/unaffected audience is left untouched",
  );

  const review = await prisma.productComplianceReview.findFirst({
    where: { productId: isolatedProductId, submissionId: submitted.submissionId },
  });
  assert.ok(review);
  assert.equal(review!.reason, "LICENCE_EXPIRED");
  assert.equal(review!.affectedAudience, "CUSTOMER");
});

test("deleting a licence submission is refused while it is pending or approved, and only allowed once inactive", async () => {
  const { categoryId: isolatedCategoryId } =
    await createIsolatedCategoryAndProduct("delete pending");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: isolatedCategoryId,
      name: "Test Licence F",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
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
      licenceNumber: "LIC-004",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc6.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  createdSubmissionIds.push(submitted.submissionId);

  const deleteWhilePending = await deleteSellerLicenceSubmission(submitted.submissionId, {
    id: adminUserId,
  });
  assert.equal(deleteWhilePending.ok, false, "a pending submission must not be deletable");

  await decideSellerLicenceSubmission(
    submitted.submissionId,
    { action: "APPROVE" },
    { id: adminUserId },
  );
  const deleteWhileApproved = await deleteSellerLicenceSubmission(submitted.submissionId, {
    id: adminUserId,
  });
  assert.equal(deleteWhileApproved.ok, false, "an approved submission must not be deletable");

  const revoked = await decideSellerLicenceSubmission(
    submitted.submissionId,
    { action: "REVOKE", reason: "Test revoke for delete coverage" },
    { id: adminUserId },
  );
  assert.equal(revoked.ok, true);

  const deleted = await deleteSellerLicenceSubmission(submitted.submissionId, { id: adminUserId });
  assert.equal(deleted.ok, true, "a revoked (inactive) submission is deletable");

  const gone = await prisma.sellerLicenceSubmission.findUnique({
    where: { id: submitted.submissionId },
  });
  assert.equal(gone, null);

  const auditRow = await prisma.auditLog.findFirst({
    where: {
      entityType: "SellerLicenceSubmission",
      entityId: submitted.submissionId,
      action: "LICENCE_SUBMISSION_DELETED",
    },
  });
  assert.ok(auditRow, "deletion is audited even though the row itself is gone");

  createdSubmissionIds.splice(createdSubmissionIds.indexOf(submitted.submissionId), 1);
});

test("deleting a submission detaches its compliance review instead of failing on the foreign key", async () => {
  const { categoryId: isolatedCategoryId, productId: isolatedProductId } =
    await createIsolatedCategoryAndProduct("delete detach review");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: isolatedCategoryId,
      name: "Test Licence G",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
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
      licenceNumber: "LIC-005",
      expiryDate: new Date(Date.now() + 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc7.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  createdSubmissionIds.push(submitted.submissionId);

  await decideSellerLicenceSubmission(
    submitted.submissionId,
    { action: "APPROVE" },
    { id: adminUserId },
  );
  await prisma.sellerLicenceSubmission.update({
    where: { id: submitted.submissionId },
    data: { expiryDate: new Date(Date.now() - 1000) },
  });
  await sweepExpiredLicenceSubmissions();

  const review = await prisma.productComplianceReview.findFirstOrThrow({
    where: { productId: isolatedProductId, submissionId: submitted.submissionId },
  });

  const deleted = await deleteSellerLicenceSubmission(submitted.submissionId, { id: adminUserId });
  assert.equal(deleted.ok, true, "expired (inactive) submissions are deletable");

  const reviewAfter = await prisma.productComplianceReview.findUniqueOrThrow({
    where: { id: review.id },
  });
  assert.equal(
    reviewAfter.submissionId,
    null,
    "the review row survives with its FK detached (SET NULL), not deleted or blocked",
  );

  createdSubmissionIds.splice(createdSubmissionIds.indexOf(submitted.submissionId), 1);
});

test("deleting a licence requirement removes its ENTIRE version chain, refusing while active or while any version has a submission on record — regression for the 'deleted version reappears as active and undeletable' bug", async () => {
  const { categoryId: isolatedCategoryId } =
    await createIsolatedCategoryAndProduct("delete requirement");
  const req = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: isolatedCategoryId,
      name: "Test Licence H",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(req.ok, true);
  if (!req.ok) return;
  createdRequirementIds.push(req.requirementId);

  const deleteWhileActive = await deleteLicenceRequirement(req.requirementId, {
    id: adminUserId,
  });
  assert.equal(deleteWhileActive.ok, false, "an active requirement must not be deletable");

  // reviseLicenceRequirement never mutates req's own row — it always
  // inserts a brand new version (v2), leaving v1 (req) in the DB with its
  // OWN isActive still stored as true. Deleting only v2 (the original,
  // buggy behavior) detached the previousVersionId FK and left v1 exactly
  // as it was: isActive true, and — since nothing points to it as a
  // previousVersion anymore — visible again as the "current" direct
  // requirement. From the admin's perspective the licence they just
  // deactivated-and-deleted reappeared, active, and undeletable. The fix
  // deletes the whole chain in one call.
  const deactivated = await reviseLicenceRequirement(
    req.requirementId,
    { isActive: false },
    "Test deactivation for delete coverage",
    { id: adminUserId },
  );
  assert.equal(deactivated.ok, true);
  if (!deactivated.ok) return;

  const deleted = await deleteLicenceRequirement(deactivated.requirementId, {
    id: adminUserId,
  });
  assert.equal(
    deleted.ok,
    true,
    "a deactivated version with no submissions anywhere in its chain is deletable",
  );

  const goneLatest = await prisma.licenceRequirement.findUnique({
    where: { id: deactivated.requirementId },
  });
  assert.equal(goneLatest, null, "the version passed in is gone");
  const goneOriginal = await prisma.licenceRequirement.findUnique({
    where: { id: req.requirementId },
  });
  assert.equal(
    goneOriginal,
    null,
    "the superseded original version is gone too — it must never resurface as 'current'",
  );

  const { direct } = await getTaxonomyNodeLicenceRequirements("CATEGORY", isolatedCategoryId);
  assert.ok(
    !direct.some((r) => r.id === req.requirementId || r.id === deactivated.requirementId),
    "nothing from this chain reappears in the direct-requirements listing",
  );

  // A submission recorded against ANY version in the chain (not just the
  // exact one passed in) blocks deleting the whole chain — proven here by
  // attaching one directly to the older version, which the public API can
  // never do once that version is inactive, but the DB-level FK is
  // RESTRICT precisely so this must never be silently cascaded away.
  const reqB = await createLicenceRequirement(
    {
      taxonomyNodeType: "CATEGORY",
      taxonomyNodeId: isolatedCategoryId,
      name: "Test Licence I",
      customerRequired: true,
      customerGeoType: "PAN_INDIA",
      dealerRequired: false,
      sameLicenceForBothAudiences: false,
    },
    { id: adminUserId },
  );
  assert.equal(reqB.ok, true);
  if (!reqB.ok) return;
  createdRequirementIds.push(reqB.requirementId);

  const submitted = await createSellerLicenceSubmission(
    sellerId,
    {
      requirementId: reqB.requirementId,
      audience: "CUSTOMER",
      licenceNumber: "LIC-006",
      expiryDate: new Date(Date.now() + 365 * 86400000),
      customerStateIds: [],
      dealerStateIds: [],
      documentStorageKey: "test/doc8.pdf",
      documentMimeType: "application/pdf",
      documentSizeBytes: 1000,
    },
    { id: sellerUserId, isAdmin: false },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  createdSubmissionIds.push(submitted.submissionId);

  const deactivatedB = await reviseLicenceRequirement(
    reqB.requirementId,
    { isActive: false },
    "Test deactivation for delete-with-submission coverage",
    { id: adminUserId },
  );
  assert.equal(deactivatedB.ok, true);
  if (!deactivatedB.ok) return;
  createdRequirementIds.push(deactivatedB.requirementId);

  const deleteWithSubmission = await deleteLicenceRequirement(deactivatedB.requirementId, {
    id: adminUserId,
  });
  assert.equal(
    deleteWithSubmission.ok,
    false,
    "a chain with a submission recorded against any of its versions must not be deletable",
  );
  const stillThereB = await prisma.licenceRequirement.findUnique({
    where: { id: deactivatedB.requirementId },
  });
  assert.ok(stillThereB, "nothing in the chain was deleted when the guard refused");
});
