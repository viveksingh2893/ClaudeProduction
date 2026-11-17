/**
 * Integration test against the real dev Postgres — per-variant image
 * gallery + video (VariantImage, ProductVariant.videoUrl). Covers:
 * persistence on create, full replace on update, and cleanup (no orphaned
 * VariantImage rows) on both single-variant removal and whole-product
 * deletion.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import type { ProductSubmissionInput } from "@kisan4u/validators";
import { applyProductSubmission } from "./product-submission";
import { removeVariant } from "./variant-generation";
import { deleteProduct } from "./product-decisions";

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
      name: `TEST FIXTURE variant-gallery ${RUN}`,
      slug: `test-fixture-variant-gallery-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const attribute = await prisma.productAttribute.create({
    data: { name: `TEST FIXTURE Colour ${RUN}`, slug: `test-fixture-colour-${RUN}` },
  });
  attributeId = attribute.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-vg-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Variant Gallery Seller",
      role: "SELLER",
      referralCode: `TESTVGSELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Variant Gallery Shop ${RUN}`,
      slug: `test-vg-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.variantImage.deleteMany({ where: { variant: { productId: id } } });
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
  // Creating a product under a seller triggers a Notification to that
  // seller's user — without deleting these first, prisma.user.delete
  // below fails on Notification_userId_fkey (caught, silent), leaving the
  // fixture user permanently orphaned (same gap found and fixed in
  // bulk-product-submission.test.ts earlier this session).
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.productAttribute.delete({ where: { id: attributeId } }).catch(() => {});
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

function baseInput(suffix: string, imageUrls: string[]): ProductSubmissionInput {
  return {
    name: `TEST FIXTURE variant gallery product ${suffix}`,
    slug: `test-fixture-variant-gallery-product-${suffix}`,
    sku: `TEST-VG-${suffix}`,
    hsnCode: "100100",
    taxPercent: 5,
    priceEntryMode: "SELLING_PRICE",
    shortDescription: "Regression fixture for per-variant image gallery/video.",
    description: "Regression fixture for per-variant image gallery/video, long enough to pass validation.",
    productType: "PHYSICAL",
    baseUnit: "PIECE",
    packageSize: "1 piece",
    searchTags: [],
    categoryId,
    audience: "CUSTOMER_ONLY",
    customerVisible: true,
    dealerVisible: false,
    customerConfig: {
      sku: `SKU-VG-${suffix}`,
      hsnCode: "100100",
      mrp: 100,
      discountType: "NONE",
      discountValue: 0,
      minOrderQty: 1,
      currentStock: 0,
      minStockQty: 5,
      reorderLevel: 10,
      shippingCalcMode: "INCLUDE_WITH_PRODUCT",
      taxCalcMode: "INCLUDE_WITH_PRICE",
    },
    attributeValues: [
      { attributeId, value: "Red", slug: "red", position: 0, isActive: true },
    ],
    customerVariants: [
      {
        attributeValueRefs: [{ attributeId, slug: "red" }],
        sku: `VG-VAR-${suffix}`,
        hsnCode: "100100",
        mrp: 100,
        discountType: "NONE",
        discountValue: 0,
        minOrderQty: 1,
        stockQty: 10,
        minStockQty: 5,
        reorderLevel: 10,
        isActive: true,
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        imageUrl: imageUrls[0] ?? "",
        images: imageUrls.slice(1).map((url, i) => ({ url, altText: `Image ${i + 2}`, position: i, isActive: true })),
        videoUrl: "https://youtube.com/watch?v=abc123",
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

test("a variant's additional images and video persist correctly on create", async () => {
  const input = baseInput(`${RUN}-a`, [
    "https://cdn.example.com/cover.jpg",
    "https://cdn.example.com/extra1.jpg",
    "https://cdn.example.com/extra2.jpg",
  ]);
  const result = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? String(result.error) : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: result.productId },
    include: { images: { orderBy: { position: "asc" } } },
  });
  assert.equal(variant.imageUrl, "https://cdn.example.com/cover.jpg");
  assert.equal(variant.videoUrl, "https://youtube.com/watch?v=abc123");
  assert.equal(variant.images.length, 2);
  assert.equal(variant.images[0]!.url, "https://cdn.example.com/extra1.jpg");
  assert.equal(variant.images[1]!.url, "https://cdn.example.com/extra2.jpg");
});

test("a variant with no images/video of its own persists as null/empty, not fabricated values", async () => {
  const input = baseInput(`${RUN}-b`, []);
  const inputNoVideo = { ...input, customerVariants: [{ ...input.customerVariants[0]!, videoUrl: undefined }] };
  const result = await applyProductSubmission(inputNoVideo, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(result.ok, true, !result.ok ? String(result.error) : "");
  if (!result.ok) return;
  createdProductIds.push(result.productId);

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: result.productId },
    include: { images: true },
  });
  assert.equal(variant.imageUrl, null);
  assert.equal(variant.videoUrl, null);
  assert.equal(variant.images.length, 0);
});

test("updating a variant's images fully replaces the previous set, not merges with it", async () => {
  const input = baseInput(`${RUN}-c`, [
    "https://cdn.example.com/c-cover.jpg",
    "https://cdn.example.com/c-old1.jpg",
    "https://cdn.example.com/c-old2.jpg",
  ]);
  const created = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(created.ok, true, !created.ok ? String(created.error) : "");
  if (!created.ok) return;
  createdProductIds.push(created.productId);

  const existingVariant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: created.productId },
  });

  const updateInput: ProductSubmissionInput = {
    ...input,
    customerVariants: [
      {
        ...input.customerVariants[0]!,
        id: existingVariant.id,
        imageUrl: "https://cdn.example.com/c-cover.jpg",
        images: [{ url: "https://cdn.example.com/c-new.jpg", altText: "New", position: 0, isActive: true }],
      },
    ],
  };
  const updated = await applyProductSubmission(updateInput, {
    mode: "UPDATE",
    productId: created.productId,
    asAdmin: false,
  });
  assert.equal(updated.ok, true, !updated.ok ? String(updated.error) : "");

  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: existingVariant.id },
    include: { images: true },
  });
  assert.equal(variant.images.length, 1);
  assert.equal(variant.images[0]!.url, "https://cdn.example.com/c-new.jpg");
});

test("removeVariant deletes its VariantImage rows — no orphans left behind", async () => {
  const input = baseInput(`${RUN}-d`, [
    "https://cdn.example.com/d-cover.jpg",
    "https://cdn.example.com/d-extra.jpg",
  ]);
  const created = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(created.ok, true, !created.ok ? String(created.error) : "");
  if (!created.ok) return;

  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: created.productId } });
  const removed = await removeVariant(variant.id);
  assert.equal(removed.ok, true);

  const orphanImages = await prisma.variantImage.count({ where: { variantId: variant.id } });
  assert.equal(orphanImages, 0);

  // The variant itself (and its base config) are gone — clean up directly
  // rather than via createdProductIds' generic teardown, which assumes a
  // still-existing product.
  await prisma.productCustomerConfig.deleteMany({ where: { productId: created.productId } });
  await prisma.productVariantAttributeValue.deleteMany({ where: { productId: created.productId } });
  await prisma.product.delete({ where: { id: created.productId } }).catch(() => {});
});

test("deleting the whole product cascades to its variants' VariantImage rows — no orphans left behind", async () => {
  const input = baseInput(`${RUN}-e`, [
    "https://cdn.example.com/e-cover.jpg",
    "https://cdn.example.com/e-extra.jpg",
  ]);
  const created = await applyProductSubmission(input, { mode: "CREATE", sellerId, asAdmin: false });
  assert.equal(created.ok, true, !created.ok ? String(created.error) : "");
  if (!created.ok) return;

  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: created.productId } });
  const imagesBefore = await prisma.variantImage.count({ where: { variantId: variant.id } });
  assert.equal(imagesBefore, 1);

  const deleted = await deleteProduct(created.productId);
  assert.equal(deleted.ok, true, !deleted.ok ? String(deleted.error) : "");

  const orphanImages = await prisma.variantImage.count({ where: { variantId: variant.id } });
  assert.equal(orphanImages, 0);
});
