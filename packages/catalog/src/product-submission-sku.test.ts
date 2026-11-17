/**
 * Integration test against the real dev Postgres — audience-specific
 * SKU/HSN (spec item #4, extended to simple/non-variant products per
 * product decision). Covers: the "-cus"/"-dea" suffix applied on save,
 * independent per-audience HSN, and the cross-table SKU-uniqueness check
 * (Product / ProductVariant / ProductCustomerConfig / ProductDealerConfig
 * all share one namespace) added to applyProductSubmission.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { productSubmissionSchema, type ProductSubmissionInput } from "@kisan4u/validators";
import { applyProductSubmission } from "./product-submission";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let categoryId: string;
let attributeId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE sku-hsn ${RUN}`,
      slug: `test-fixture-sku-hsn-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const attribute = await prisma.productAttribute.create({
    data: { name: `TEST FIXTURE Size ${RUN}`, slug: `test-fixture-size-${RUN}` },
  });
  attributeId = attribute.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-sku-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE SKU Seller",
      role: "SELLER",
      referralCode: `TESTSKUSELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test SKU Shop ${RUN}`,
      slug: `test-sku-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.productDealerConfig.delete({ where: { productId: id } }).catch(() => {});
    // The variant-combination test leaves ProductVariant/ProductVariantValue/
    // ProductVariantAttributeValue rows — without deleting those first,
    // product.delete() below fails on the FK constraint (silently, since
    // it's caught) and orphans the whole product forever.
    const variantIds = await prisma.productVariant.findMany({
      where: { productId: id },
      select: { id: true },
    });
    await prisma.productVariantValue.deleteMany({
      where: { variantId: { in: variantIds.map((v) => v.id) } },
    });
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.productVariantAttributeValue.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.productAttribute.delete({ where: { id: attributeId } }).catch(() => {});
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

/** Minimal valid simple (no-variant), BOTH-audience product submission — only the sku/hsnCode inputs vary per test. */
function baseInput(
  suffix: string,
  overrides: { customerSku: string; dealerSku: string },
): ProductSubmissionInput {
  return {
    name: `TEST FIXTURE sku-hsn product ${suffix}`,
    slug: `test-fixture-sku-hsn-product-${suffix}`,
    sku: `TEST-SKU-HSN-${suffix}`,
    hsnCode: "100100",
    taxPercent: 0,
    priceEntryMode: "SELLING_PRICE",
    shortDescription: "Regression fixture for audience SKU/HSN.",
    description: "Regression fixture for audience SKU/HSN, long enough to pass validation.",
    productType: "PHYSICAL",
    baseUnit: "PIECE",
    packageSize: "1 piece",
    searchTags: [],
    categoryId,
    audience: "BOTH_CUSTOMER_AND_DEALER",
    customerVisible: true,
    dealerVisible: true,
    customerConfig: {
      sku: overrides.customerSku,
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
    dealerConfig: {
      sku: overrides.dealerSku,
      hsnCode: "100200",
      mrp: 90,
      discountType: "NONE",
      discountValue: 0,
      minOrderQty: 1,
      currentStock: 20,
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
  };
}

test("a simple BOTH-audience product gets separate customer/dealer SKUs ending in -cus/-dea, and independent HSN per audience", async () => {
  const result = await applyProductSubmission(baseInput(`${RUN}-a`, { customerSku: `SKU-A-${RUN}`, dealerSku: `SKU-A-${RUN}` }), {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const [customerConfig, dealerConfig] = await Promise.all([
    prisma.productCustomerConfig.findUnique({ where: { productId: result.productId } }),
    prisma.productDealerConfig.findUnique({ where: { productId: result.productId } }),
  ]);

  assert.equal(customerConfig?.sku, `SKU-A-${RUN}-cus`);
  assert.equal(dealerConfig?.sku, `SKU-A-${RUN}-dea`);
  assert.equal(customerConfig?.hsnCode, "100100");
  assert.equal(dealerConfig?.hsnCode, "100200");
  // Independent stock, unaffected by this feature but re-asserted here as
  // the manual-verification checklist item "customer/dealer quantities
  // independent" — same product, two different opening stocks.
  assert.equal(customerConfig?.currentStock, 10);
  assert.equal(dealerConfig?.currentStock, 20);
});

test("re-saving with an already-suffixed SKU does not double-suffix it", async () => {
  const result = await applyProductSubmission(
    baseInput(`${RUN}-b`, { customerSku: `SKU-B-${RUN}-cus`, dealerSku: `SKU-B-${RUN}-dea` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const customerConfig = await prisma.productCustomerConfig.findUnique({
    where: { productId: result.productId },
  });
  assert.equal(customerConfig?.sku, `SKU-B-${RUN}-cus`);
});

test("a customer SKU carrying the dealer suffix is rejected", async () => {
  const result = await applyProductSubmission(
    baseInput(`${RUN}-c`, { customerSku: `SKU-C-${RUN}-dea`, dealerSku: `SKU-C-${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(result.ok, false);
});

test("a dealer config SKU cannot collide with another product's customer config SKU", async () => {
  const first = await applyProductSubmission(
    baseInput(`${RUN}-d1`, { customerSku: `SKU-SHARED-${RUN}`, dealerSku: `SKU-D1-${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(first.ok, true);
  if (first.ok) createdProductIds.push(first.productId);

  const second = await applyProductSubmission(
    baseInput(`${RUN}-d2`, { customerSku: `SKU-D2-${RUN}`, dealerSku: `SKU-SHARED-${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  // first product's customer sku normalizes to "SKU-SHARED-cus"; second
  // product's dealer sku normalizes to "SKU-SHARED-dea" — different final
  // strings, so this must NOT clash. This proves normalization runs
  // before the uniqueness check, not after.
  assert.equal(second.ok, true);
  if (second.ok) createdProductIds.push(second.productId);
});

test("two products cannot use the exact same final customer SKU", async () => {
  const first = await applyProductSubmission(
    baseInput(`${RUN}-e1`, { customerSku: `SKU-DUP-${RUN}-cus`, dealerSku: `SKU-E1-${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(first.ok, true);
  if (first.ok) createdProductIds.push(first.productId);

  const second = await applyProductSubmission(
    baseInput(`${RUN}-e2`, { customerSku: `SKU-DUP-${RUN}`, dealerSku: `SKU-E2-${RUN}` }),
    { mode: "CREATE", sellerId, asAdmin: false },
  );
  assert.equal(second.ok, false);
  if (second.ok) createdProductIds.push((second as { ok: true; productId: string }).productId);
});

test("the exact same variant combination (Red/Large) sold to both audiences gets two separate SKUs ending in -cus/-dea, and customer/dealer stock is independent — the scenario in item #8's manual-verification checklist", async () => {
  const input: ProductSubmissionInput = {
    ...baseInput(`${RUN}-variant`, { customerSku: "IGNORED", dealerSku: "IGNORED" }),
    customerConfig: undefined,
    dealerConfig: undefined,
    attributeValues: [
      { attributeId, value: "Red/Large", slug: "red-large", position: 0, isActive: true },
    ],
    customerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "red-large" }],
        sku: `RL-BASE-${RUN}`,
        hsnCode: "100100",
        mrp: 100,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 15,
        minStockQty: 5,
        reorderLevel: 10,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        images: [],
      },
    ],
    dealerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "red-large" }],
        sku: `RL-BASE-${RUN}`,
        hsnCode: "100200",
        mrp: 90,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 40,
        minStockQty: 5,
        reorderLevel: 10,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        images: [],
      },
    ],
  };

  const result = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const variants = await prisma.productVariant.findMany({
    where: { productId: result.productId },
    orderBy: { audience: "asc" },
  });
  assert.equal(variants.length, 2);

  const customerVariant = variants.find((v) => v.audience === "CUSTOMER");
  const dealerVariant = variants.find((v) => v.audience === "DEALER");
  assert.equal(customerVariant?.sku, `RL-BASE-${RUN}-cus`);
  assert.equal(dealerVariant?.sku, `RL-BASE-${RUN}-dea`);
  assert.equal(customerVariant?.hsnCode, "100100");
  assert.equal(dealerVariant?.hsnCode, "100200");
  // Same combinationKey (same Red/Large attribute value), two fully
  // independent stock pools — proves audience-level stock separation
  // holds even for the exact same variant combination.
  assert.equal(customerVariant?.combinationKey, dealerVariant?.combinationKey);
  assert.equal(customerVariant?.stockQty, 15);
  assert.equal(dealerVariant?.stockQty, 40);
});

test("a variant referencing an attribute value that wasn't submitted fails gracefully (ok:false), not as an unhandled server error", async () => {
  const input: ProductSubmissionInput = {
    ...baseInput(`${RUN}-stale-ref`, { customerSku: "IGNORED", dealerSku: `STALE-${RUN}` }),
    dealerConfig: undefined,
    // No matching entry in attributeValues for this slug — reproduces a
    // client sending a variant whose attributeValueRefs drifted out of
    // sync with the attribute values it actually submitted (e.g. one was
    // renamed/removed client-side without the reference being cleaned up
    // first). Before this fix, resolveVariantRows (product-submission.ts)
    // threw a raw Error from inside the prisma.$transaction callback,
    // which propagated as an unhandled exception all the way up through
    // applyProductSubmission — a real production incident, surfaced to
    // sellers as a generic "server-side error" instead of an actionable
    // message.
    attributeValues: [],
    customerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "nonexistent-slug" }],
        sku: `STALE-VAR-${RUN}`,
        hsnCode: "100100",
        mrp: 100,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 5,
        minStockQty: 1,
        reorderLevel: 2,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        images: [],
      },
    ],
    dealerVariants: [],
  };

  const result = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /attribute value/i);

  // Nothing was left half-created — the transaction rolled back cleanly.
  const orphan = await prisma.product.findFirst({ where: { sku: `TEST-SKU-HSN-${RUN}-stale-ref` } });
  assert.equal(orphan, null);
});

test("a variant's attribute-value ref normalizes the same way the value's own slug does — mismatched casing/whitespace no longer breaks the save", async () => {
  // Reproduces the real bug: attributeValueRefSchema used to be a plain
  // z.string().min(1) while productAttributeValueInputSchema's slug went
  // through slugSchema (trim + lowercase). A value saved with a manually
  // typed, messy slug and a ref typed differently (e.g. via the auto-
  // slugify-on-first-keystroke UI quirk) parsed to two DIFFERENT strings,
  // so resolveVariantRows' lookup missed even though the value genuinely
  // was submitted — surfaced as "A variant referenced an attribute value
  // that wasn't submitted." Both fields now share slugSchema, so this
  // must parse and save cleanly regardless of the casing/whitespace the
  // client happened to send on either side.
  const rawInput = {
    ...baseInput(`${RUN}-slug-case`, { customerSku: "IGNORED", dealerSku: `SLUGCASE-${RUN}` }),
    audience: "CUSTOMER_ONLY",
    dealerVisible: false,
    dealerConfig: undefined,
    attributeValues: [{ attributeId, value: "Red", slug: "  RED  ", position: 0, isActive: true }],
    customerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "Red" }],
        sku: `SLUGCASE-VAR-${RUN}`,
        hsnCode: "100100",
        mrp: 100,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 5,
        minStockQty: 1,
        reorderLevel: 2,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        images: [],
      },
    ],
    dealerVariants: [],
  };

  const parsed = productSubmissionSchema.safeParse(rawInput);
  assert.equal(parsed.success, true, parsed.success ? "" : String(parsed.error.issues[0]?.message));
  if (!parsed.success) return;
  // The two sides really did normalize to the exact same string —
  // confirms this test would have caught the original asymmetry.
  assert.equal(parsed.data.attributeValues[0]?.slug, "red");
  assert.equal(parsed.data.customerVariants[0]?.attributeValueRefs[0]?.slug, "red");

  const result = await applyProductSubmission(parsed.data, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? result.error : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: result.productId },
    include: { values: { include: { attributeValue: true } } },
  });
  assert.equal(variant.values.length, 1);
  assert.equal(variant.values[0]?.attributeValue.slug, "red");
});

test("package size is not required for a variant product, but still required for a non-variant one", async () => {
  const variantInput = {
    ...baseInput(`${RUN}-pkg-variant`, { customerSku: "IGNORED", dealerSku: `PKGVAR-${RUN}` }),
    audience: "CUSTOMER_ONLY",
    dealerVisible: false,
    dealerConfig: undefined,
    packageSize: "",
    attributeValues: [{ attributeId, value: "One Size", slug: "one-size", position: 0, isActive: true }],
    customerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "one-size" }],
        sku: `PKGVAR-VAR-${RUN}`,
        hsnCode: "100100",
        mrp: 100,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 5,
        minStockQty: 1,
        reorderLevel: 2,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        images: [],
      },
    ],
    dealerVariants: [],
  };
  const variantParsed = productSubmissionSchema.safeParse(variantInput);
  assert.equal(
    variantParsed.success,
    true,
    variantParsed.success ? "" : String(variantParsed.error.issues[0]?.message),
  );

  const nonVariantInput = {
    ...baseInput(`${RUN}-pkg-simple`, { customerSku: "IGNORED", dealerSku: `PKGSIMPLE-${RUN}` }),
    audience: "CUSTOMER_ONLY",
    dealerVisible: false,
    dealerConfig: undefined,
    packageSize: "",
  };
  const simpleParsed = productSubmissionSchema.safeParse(nonVariantInput);
  assert.equal(simpleParsed.success, false);
  if (simpleParsed.success) return;
  assert.ok(simpleParsed.error.issues.some((i) => i.path.includes("packageSize")));
});
