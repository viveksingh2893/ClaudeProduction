/**
 * Integration test against the real dev Postgres — the "Display on
 * product card" feature (product-form.tsx) and its read-side counterpart
 * in product-card-adapter.ts: a variant product's card price now comes
 * from its own base config (the seller's explicit card-display MRP/
 * selling price) whenever one is actually set, in preference to the
 * default variant's price — but still falls back to the default
 * variant's price for a product saved before this field existed (base
 * config still carrying the old mrp=0 placeholder), so no pre-existing
 * card silently changes.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import type { ProductSubmissionInput } from "@kisan4u/validators";
import { applyProductSubmission } from "./product-submission";
import { getCustomerCatalogue } from "./queries";
import { adaptCustomerProduct } from "./product-card-adapter";

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
      name: `TEST FIXTURE card-pricing ${RUN}`,
      slug: `test-fixture-card-pricing-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const attribute = await prisma.productAttribute.create({
    data: { name: `TEST FIXTURE Size ${RUN}`, slug: `test-fixture-size-cp-${RUN}` },
  });
  attributeId = attribute.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-cardprice-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Card Pricing Seller",
      role: "SELLER",
      referralCode: `TESTCARDPRICE${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Card Pricing Shop ${RUN}`,
      slug: `test-cardprice-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.deleteMany({ where: { productId: id } });
    const variantIds = await prisma.productVariant.findMany({
      where: { productId: id },
      select: { id: true },
    });
    await prisma.productVariantValue.deleteMany({ where: { variantId: { in: variantIds.map((v) => v.id) } } });
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.productVariantAttributeValue.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.productAttribute.delete({ where: { id: attributeId } }).catch(() => {});
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

function baseVariantInput(
  suffix: string,
  cardMrp: number,
  cardSellingPrice: number,
): ProductSubmissionInput {
  const discountValue = cardMrp - cardSellingPrice;
  return {
    name: `TEST FIXTURE card-pricing product ${suffix}`,
    slug: `test-fixture-card-pricing-product-${suffix}`,
    sku: `TEST-CARDPRICE-${suffix}`,
    hsnCode: "100100",
    taxPercent: 0,
    priceEntryMode: "SELLING_PRICE",
    shortDescription: "Regression fixture for card-price priority.",
    description: "Regression fixture for card-price priority, long enough to pass validation.",
    productType: "PHYSICAL",
    baseUnit: "PIECE",
    packageSize: "",
    searchTags: [],
    categoryId,
    audience: "CUSTOMER_ONLY",
    customerVisible: true,
    dealerVisible: false,
    customerConfig: {
      sku: `SKU-CARDPRICE-${suffix}`,
      hsnCode: "100100",
      mrp: cardMrp,
      discountType: discountValue > 0 ? "FLAT" : "NONE",
      discountValue,
      minOrderQty: 1,
      currentStock: 0,
      minStockQty: 5,
      reorderLevel: 10,
      shippingCalcMode: "INCLUDE_WITH_PRODUCT",
      taxCalcMode: "INCLUDE_WITH_PRICE",
    },
    attributeValues: [{ attributeId, value: "Large", slug: "large", position: 0, isActive: true }],
    customerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "large" }],
        sku: `CARDPRICE-VAR-${suffix}`,
        hsnCode: "100100",
        mrp: 50,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 10,
        minStockQty: 5,
        reorderLevel: 10,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        images: [],
      },
    ],
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
  } as ProductSubmissionInput;
}

test("a variant product's explicit card price (base config MRP > 0) wins over the default variant's own price on the card", async () => {
  const input = baseVariantInput(`${RUN}-a`, 200, 180);
  const result = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? result.error : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);
  await prisma.product.update({ where: { id: result.productId }, data: { lifecycleStatus: "APPROVED" } });

  const match = (await getCustomerCatalogue({})).find((p) => p.id === result.productId);
  assert.ok(match, "product should be visible in the customer catalogue");
  const card = adaptCustomerProduct(match!, { ratingThreshold: 0, wishlisted: false });
  assert.equal(card.pricing.kind, "CUSTOMER");
  if (card.pricing.kind !== "CUSTOMER") return;
  assert.equal(card.pricing.mrp, 200);
  assert.equal(card.pricing.sellingPrice, 180);
});

test("a variant product with no card price set (base config still mrp=0) falls back to the default variant's own price", async () => {
  const input = baseVariantInput(`${RUN}-b`, 0, 0);
  const result = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? result.error : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);
  await prisma.product.update({ where: { id: result.productId }, data: { lifecycleStatus: "APPROVED" } });

  const match = (await getCustomerCatalogue({})).find((p) => p.id === result.productId);
  assert.ok(match, "product should be visible in the customer catalogue");
  const card = adaptCustomerProduct(match!, { ratingThreshold: 0, wishlisted: false });
  assert.equal(card.pricing.kind, "CUSTOMER");
  if (card.pricing.kind !== "CUSTOMER") return;
  assert.equal(card.pricing.mrp, 50);
});
