/**
 * Integration test against the real dev Postgres — "save at any point"
 * single-product drafts (packages/catalog/src/product-draft.ts). Covers:
 * saving with only a name, placeholder uniqueness across repeated saves,
 * the DRAFT -> SUBMITTED completeness gate (assertProductComplete) both
 * rejecting an incomplete draft and accepting a genuinely complete one,
 * and that filling in real data over several saves converges to a normal,
 * submittable product.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { productDraftSubmissionSchema, type ProductDraftSubmissionInput } from "@kisan4u/validators";
import { saveProductDraft, DRAFT_PLACEHOLDER_CATEGORY_SLUG } from "./product-draft";
import { submitProductForApproval, assertProductComplete } from "./product-decisions";

/** Mirrors what a real server action does: parse the raw client payload through the lenient schema (defaulting attributeValues/customerVariants/dealerVariants/etc.) before ever calling saveProductDraft. */
function parseDraft(raw: Record<string, unknown>): ProductDraftSubmissionInput {
  const result = productDraftSubmissionSchema.safeParse(raw);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid draft input");
  return result.data;
}

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let categoryId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE product-draft ${RUN}`,
      slug: `test-fixture-product-draft-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-pd-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Product Draft Seller",
      role: "SELLER",
      referralCode: `TESTPDSELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Product Draft Shop ${RUN}`,
      slug: `test-pd-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.deleteMany({ where: { productId: id } });
    await prisma.productDealerConfig.deleteMany({ where: { productId: id } });
    await prisma.variantImage.deleteMany({ where: { variant: { productId: id } } });
    const variantIds = await prisma.productVariant.findMany({
      where: { productId: id },
      select: { id: true },
    });
    await prisma.productVariantValue.deleteMany({ where: { variantId: { in: variantIds.map((v) => v.id) } } });
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.productVariantAttributeValue.deleteMany({ where: { productId: id } });
    await prisma.productImage.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  // See variant-gallery.test.ts / bulk-product-submission.test.ts — creating
  // a product under a seller triggers a Notification to that seller's user;
  // without deleting these first, prisma.user.delete below fails silently
  // on Notification_userId_fkey and permanently orphans the fixture user.
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
  // The draft placeholder category is a permanent, lazily-created system
  // row (any draft with no category yet points at it) — it's deliberately
  // NOT deleted here, the same way a real app boot wouldn't tear it down.
});

test("a real product-form payload — every untouched field sent as \"\", not omitted — still saves with just a name (regression: .partial() alone doesn't excuse an empty string, only an absent key)", async () => {
  const draft = parseDraft({
    name: `TEST FIXTURE draft form-empty-strings ${RUN}`,
    slug: "",
    sku: "",
    hsnCode: "",
    shortDescription: "",
    description: "",
    packageSize: "",
    categoryId: "",
    primaryImageUrl: "",
    videoUrl: "",
    audience: "CUSTOMER_ONLY",
    baseUnit: "PIECE",
    customerVisible: true,
    dealerVisible: true,
    customerConfig: {
      sku: "",
      hsnCode: "",
      mrp: "",
      discountType: "NONE",
      discountValue: "0",
      minOrderQty: "1",
      currentStock: "0",
      minStockQty: "5",
      reorderLevel: "10",
      taxPercent: "0",
      shippingCalcMode: "INCLUDE_WITH_PRODUCT",
      taxCalcMode: "INCLUDE_WITH_PRICE",
    },
    attributeValues: [],
    customerVariants: [],
    dealerVariants: [],
    customerStateIds: [],
    dealerStateIds: [],
    images: [],
  });
  const result = await saveProductDraft(draft, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? String(result.error) : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: result.productId } });
  assert.equal(product.name, `TEST FIXTURE draft form-empty-strings ${RUN}`);
  assert.equal(product.lifecycleStatus, "DRAFT");
  assert.ok(product.slug.length > 0);
});

test("a draft with only a name saves successfully, with safe placeholders filling everything else", async () => {
  const draft = parseDraft({ name: `TEST FIXTURE draft name-only ${RUN}` });
  const result = await saveProductDraft(draft, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? String(result.error) : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: result.productId } });
  assert.equal(product.name, `TEST FIXTURE draft name-only ${RUN}`);
  assert.equal(product.lifecycleStatus, "DRAFT");
  assert.ok(product.slug.length > 0);
  assert.ok(product.sku.length > 0);
  assert.equal(product.hsnCode, "");
  assert.equal(product.shortDescription, "");
  assert.equal(product.primaryImageUrl, "");

  const placeholderCategory = await prisma.category.findUniqueOrThrow({
    where: { slug: DRAFT_PLACEHOLDER_CATEGORY_SLUG },
  });
  assert.equal(product.categoryId, placeholderCategory.id);
  assert.equal(placeholderCategory.isActive, false);
});

test("two drafts saved with the exact same name each get their own distinct slug — no collision", async () => {
  const name = `TEST FIXTURE draft dup-name ${RUN}`;
  const first = await saveProductDraft(parseDraft({ name }), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(first.ok, true);
  if (first.ok) createdProductIds.push(first.productId);

  const second = await saveProductDraft(parseDraft({ name }), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(second.ok, true);
  if (second.ok) createdProductIds.push(second.productId);

  if (!first.ok || !second.ok) return;
  const [p1, p2] = await Promise.all([
    prisma.product.findUniqueOrThrow({ where: { id: first.productId } }),
    prisma.product.findUniqueOrThrow({ where: { id: second.productId } }),
  ]);
  assert.notEqual(p1.slug, p2.slug);
  assert.notEqual(p1.sku, p2.sku);
});

test("submitting a still-incomplete draft for approval is rejected with a specific reason, and it stays a DRAFT", async () => {
  const result = await saveProductDraft(
    parseDraft({ name: `TEST FIXTURE draft incomplete-submit ${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const completeness = await assertProductComplete(result.productId);
  assert.equal(completeness.ok, false);
  if (completeness.ok) return;
  assert.match(completeness.error, /category/i);

  const submitResult = await submitProductForApproval(sellerId, result.productId);
  assert.equal(submitResult.ok, false);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: result.productId } });
  assert.equal(product.lifecycleStatus, "DRAFT");
});

test("a draft that has been filled in with all real required fields passes the completeness gate and submits successfully", async () => {
  const partial = await saveProductDraft(
    parseDraft({ name: `TEST FIXTURE draft complete ${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  createdProductIds.push(partial.productId);

  const complete = parseDraft({
    name: `TEST FIXTURE draft complete ${RUN}`,
    slug: `test-fixture-draft-complete-${RUN}`,
    sku: `TEST-DRAFT-COMPLETE-${RUN}`,
    hsnCode: "100100",
    shortDescription: "A real short description, long enough to pass validation.",
    description: "A real full description, long enough to pass validation on its own visible length.",
    baseUnit: "PIECE",
    packageSize: "1 piece",
    categoryId,
    audience: "CUSTOMER_ONLY",
    customerVisible: true,
    dealerVisible: false,
    customerConfig: {
      sku: `SKU-DRAFT-COMPLETE-${RUN}`,
      hsnCode: "100100",
      mrp: 100,
      discountType: "NONE",
      discountValue: 0,
      minOrderQty: 1,
      currentStock: 5,
      minStockQty: 1,
      reorderLevel: 2,
      taxPercent: 0,
      shippingCalcMode: "INCLUDE_WITH_PRODUCT",
      taxCalcMode: "INCLUDE_WITH_PRICE",
    },
    attributeValues: [],
    customerVariants: [],
    dealerVariants: [],
    customerStateIds: [],
    dealerStateIds: [],
    primaryImageUrl: "/test/fixture.jpg",
    images: [],
    availabilityBadgeMode: "AUTOMATIC",
    deliveryBadgeEnabled: false,
  });

  const updated = await saveProductDraft(complete, {
    mode: "UPDATE",
    productId: partial.productId,
    asAdmin: false,
  });
  assert.equal(updated.ok, true, !updated.ok ? String(updated.error) : "");

  const completeness = await assertProductComplete(partial.productId);
  assert.equal(completeness.ok, true, !completeness.ok ? completeness.error : "");

  const submitResult = await submitProductForApproval(sellerId, partial.productId);
  assert.equal(submitResult.ok, true, !submitResult.ok ? submitResult.error : "");

  const product = await prisma.product.findUniqueOrThrow({ where: { id: partial.productId } });
  assert.equal(product.lifecycleStatus, "SUBMITTED");
  assert.equal(product.categoryId, categoryId);
});
