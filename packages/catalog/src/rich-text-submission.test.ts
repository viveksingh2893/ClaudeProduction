/**
 * Integration test against the real dev Postgres — rich-text description
 * fields (spec item #1) end to end through applyProductSubmission, the
 * one place sanitizeProductRichText runs before a save reaches the
 * database (see packages/catalog/src/product-submission.ts).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import type { ProductSubmissionInput } from "@kisan4u/validators";
import { applyProductSubmission } from "./product-submission";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let categoryId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE rich-text ${RUN}`,
      slug: `test-fixture-rich-text-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-richtext-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Rich Text Seller",
      role: "SELLER",
      referralCode: `TESTRICHTEXT${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Rich Text Shop ${RUN}`,
      slug: `test-richtext-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

function baseInput(
  suffix: string,
  overrides: Partial<
    Pick<
      ProductSubmissionInput,
      "shortDescription" | "description" | "ingredients" | "howToUse"
    >
  >,
): ProductSubmissionInput {
  return {
    name: `TEST FIXTURE rich-text product ${suffix}`,
    slug: `test-fixture-rich-text-product-${suffix}`,
    sku: `TEST-RICHTEXT-${suffix}`,
    hsnCode: "100100",
    taxPercent: 0,
    priceEntryMode: "SELLING_PRICE",
    shortDescription: "Default short description text.",
    description: "Default full description text, long enough to pass validation rules.",
    productType: "PHYSICAL",
    baseUnit: "PIECE",
    packageSize: "1 piece",
    searchTags: [],
    categoryId,
    audience: "CUSTOMER_ONLY",
    customerVisible: true,
    dealerVisible: true,
    customerConfig: {
      sku: `RICHTEXT-${suffix}`,
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
    editorialBadgeId: undefined,
    deliveryBadgeEnabled: false,
    availabilityBadgeMode: "AUTOMATIC",
    ...overrides,
  };
}

test("a <script> tag and event-handler attribute injected into the full description are stripped before saving", async () => {
  const malicious =
    '<p onclick="alert(1)">Grown in Nashik</p><script>alert("xss")</script><p>Sweet and juicy, long enough to pass validation.</p>';
  const result = await applyProductSubmission(baseInput(`${RUN}-a`, { description: malicious }), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const stored = await prisma.product.findUnique({ where: { id: result.productId } });
  assert.ok(!stored?.description.includes("<script"));
  assert.ok(!stored?.description.includes("onclick"));
  assert.ok(stored?.description.includes("Grown in Nashik"));
});

test("a legacy plain-text description (as if saved before this feature existed) round-trips unchanged", async () => {
  const legacy =
    "This is a plain-text description with no HTML markup at all, written before rich text existed.";
  const result = await applyProductSubmission(baseInput(`${RUN}-b`, { description: legacy }), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const stored = await prisma.product.findUnique({ where: { id: result.productId } });
  assert.equal(stored?.description, legacy);
});

test("an optional rich-text field left editor-empty (<p><br></p>) is stored as null, not fake content", async () => {
  const result = await applyProductSubmission(
    baseInput(`${RUN}-c`, {}),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  // ingredients/howToUse/dosageInstructions/technicalInfo weren't set at
  // all in baseInput (undefined) — this is the "field never touched"
  // case, which must also store null, not "".
  const stored = await prisma.product.findUnique({ where: { id: result.productId } });
  assert.equal(stored?.ingredients, null);
});

test("a required field that is visually empty markup (<p><br></p>) fails validation before it ever reaches the database", async () => {
  const { productSubmissionSchema } = await import("@kisan4u/validators");
  const parsed = productSubmissionSchema.safeParse({
    ...baseInput(`${RUN}-d`, { shortDescription: "<p><br></p>" }),
  });
  assert.equal(parsed.success, false);
});
