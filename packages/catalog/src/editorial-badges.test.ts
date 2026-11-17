/**
 * Integration test against the real dev Postgres — admin-managed editorial
 * badges (spec item #3). Covers: the EDITORIAL/DEAL priority-slot split
 * (preserving the pre-migration badge-resolution.ts behavior), and the
 * seller-cannot-set-merchandising-fields server-side enforcement added to
 * applyProductSubmission (packages/catalog/src/product-submission.ts).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import type { ProductSubmissionInput } from "@kisan4u/validators";
import { applyProductSubmission } from "./product-submission";
import { adaptCustomerProduct } from "./product-card-adapter";
import { CUSTOMER_INCLUDE } from "./queries";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let categoryId: string;
let editorialBadgeId: string;
let dealBadgeId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];
const createdBadgeIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE editorial-badges ${RUN}`,
      slug: `test-fixture-editorial-badges-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-badge-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Badge Seller",
      role: "SELLER",
      referralCode: `TESTBADGESELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Badge Shop ${RUN}`,
      slug: `test-badge-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const editorialBadge = await prisma.editorialBadge.create({
    data: {
      name: `TEST Trending ${RUN}`,
      slug: `test-trending-${RUN}`,
      tone: "SUCCESS",
      kind: "EDITORIAL",
    },
  });
  editorialBadgeId = editorialBadge.id;
  createdBadgeIds.push(editorialBadgeId);

  const dealBadge = await prisma.editorialBadge.create({
    data: {
      name: `TEST Clearance ${RUN}`,
      slug: `test-clearance-${RUN}`,
      tone: "WARNING",
      kind: "DEAL",
    },
  });
  dealBadgeId = dealBadge.id;
  createdBadgeIds.push(dealBadgeId);
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.productDealerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdBadgeIds) {
    await prisma.editorialBadge.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

function baseInput(suffix: string, editorialBadgeIdInput?: string): ProductSubmissionInput {
  return {
    name: `TEST FIXTURE badge product ${suffix}`,
    slug: `test-fixture-badge-product-${suffix}`,
    sku: `TEST-BADGE-${suffix}`,
    hsnCode: "100100",
    taxPercent: 0,
    priceEntryMode: "SELLING_PRICE",
    shortDescription: "Regression fixture for editorial badges.",
    description: "Regression fixture for editorial badges, long enough to pass validation.",
    productType: "PHYSICAL",
    baseUnit: "PIECE",
    packageSize: "1 piece",
    searchTags: [],
    categoryId,
    audience: "CUSTOMER_ONLY",
    customerVisible: true,
    dealerVisible: true,
    customerConfig: {
      sku: `BADGE-${suffix}`,
      hsnCode: "100100",
      mrp: 100,
      discountType: "NONE",
      discountValue: 0,
      minOrderQty: 1,
      currentStock: 10,
      minStockQty: 5,
      reorderLevel: 10,
      shippingCalcMode: "INCLUDE_WITH_PRODUCT",
      taxCalcMode: "INCLUDE_WITH_PRICE",
    },
    attributeValues: [],
    customerVariants: [],
    dealerVariants: [],
    customerStateIds: [],
    dealerStateIds: [],
    cropIds: [],
    pestDiseaseIds: [],
    primaryImageUrl: "/test/fixture.jpg",
    images: [],
    subtitle: undefined,
    editorialBadgeId: editorialBadgeIdInput,
    deliveryBadgeEnabled: false,
    availabilityBadgeMode: "AUTOMATIC",
    featuredPosition: 42,
  };
}

test("admin can set an EDITORIAL-kind badge, and it resolves into the editorial (4th) priority slot on the card", async () => {
  // Real workflow: a product is always seller-CREATEd first (CREATE is
  // hardcoded asAdmin:false at the type level — admin never creates
  // directly), then an admin UPDATEs it to assign merchandising fields.
  const created = await applyProductSubmission(baseInput(`${RUN}-a`, undefined), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  createdProductIds.push(created.productId);

  const updated = await applyProductSubmission(baseInput(`${RUN}-a`, editorialBadgeId), {
    mode: "UPDATE",
    productId: created.productId,
    asAdmin: true,
  });
  assert.equal(updated.ok, true);

  const stored = await prisma.product.findUnique({ where: { id: created.productId } });
  assert.equal(stored?.editorialBadgeId, editorialBadgeId);
  assert.equal(stored?.featuredPosition, 42);

  const full = await prisma.product.findUnique({
    where: { id: created.productId },
    include: CUSTOMER_INCLUDE,
  });
  assert.ok(full);
  const card = adaptCustomerProduct(full!, { ratingThreshold: 5, wishlisted: false });
  assert.deepEqual(card.badge, { text: `TEST Trending ${RUN}`, tone: "success" });
});

test("admin can set a DEAL-kind badge, and it resolves into the deal (2nd) priority slot — outranking a delivery badge", async () => {
  const created = await applyProductSubmission(baseInput(`${RUN}-b`, undefined), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  createdProductIds.push(created.productId);

  const input = { ...baseInput(`${RUN}-b`, dealBadgeId), deliveryBadgeEnabled: true };
  const updated = await applyProductSubmission(input, {
    mode: "UPDATE",
    productId: created.productId,
    asAdmin: true,
  });
  assert.equal(updated.ok, true);

  const full = await prisma.product.findUnique({
    where: { id: created.productId },
    include: CUSTOMER_INCLUDE,
  });
  const card = adaptCustomerProduct(full!, { ratingThreshold: 5, wishlisted: false });
  // Deal (priority 2) must win over the delivery badge (priority 3), even
  // though deliveryBadgeEnabled is also true on this product.
  assert.deepEqual(card.badge, { text: `TEST Clearance ${RUN}`, tone: "warning" });
});

test("a seller (asAdmin=false) cannot set an editorial badge or featured position on a new product", async () => {
  const result = await applyProductSubmission(baseInput(`${RUN}-c`, editorialBadgeId), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const stored = await prisma.product.findUnique({ where: { id: result.productId } });
  assert.equal(stored?.editorialBadgeId, null);
  assert.equal(stored?.featuredPosition, null);
});

test("a seller's routine edit does not erase a badge/featured position an admin already set", async () => {
  const created = await applyProductSubmission(baseInput(`${RUN}-d`, undefined), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  createdProductIds.push(created.productId);

  const adminSet = await applyProductSubmission(baseInput(`${RUN}-d`, editorialBadgeId), {
    mode: "UPDATE",
    productId: created.productId,
    asAdmin: true,
  });
  assert.equal(adminSet.ok, true);

  // Seller edits the same product (e.g. fixing the description) — their
  // payload has NO editorialBadgeId, matching what the seller's own form
  // actually sends (the field is hidden/locked for them).
  const sellerEdit = {
    ...baseInput(`${RUN}-d`, undefined),
    description: "Updated description text, long enough to pass validation rules.",
  };
  const updateResult = await applyProductSubmission(sellerEdit, {
    mode: "UPDATE",
    productId: created.productId,
    asAdmin: false,
  });
  assert.equal(updateResult.ok, true);

  const stored = await prisma.product.findUnique({ where: { id: created.productId } });
  assert.equal(stored?.editorialBadgeId, editorialBadgeId, "badge must survive a seller edit");
  assert.equal(stored?.featuredPosition, 42, "featured position must survive a seller edit");
  assert.equal(stored?.description, sellerEdit.description);
});

test("deactivating a badge does not clear a product's existing assignment", async () => {
  const scratchBadge = await prisma.editorialBadge.create({
    data: { name: `TEST Scratch ${RUN}`, slug: `test-scratch-${RUN}`, tone: "INFO" },
  });
  createdBadgeIds.push(scratchBadge.id);

  const created = await applyProductSubmission(baseInput(`${RUN}-e`, undefined), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  createdProductIds.push(created.productId);

  const adminSet = await applyProductSubmission(baseInput(`${RUN}-e`, scratchBadge.id), {
    mode: "UPDATE",
    productId: created.productId,
    asAdmin: true,
  });
  assert.equal(adminSet.ok, true);

  await prisma.editorialBadge.update({ where: { id: scratchBadge.id }, data: { isActive: false } });

  const stored = await prisma.product.findUnique({ where: { id: created.productId } });
  assert.equal(stored?.editorialBadgeId, scratchBadge.id);
});
