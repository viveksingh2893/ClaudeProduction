/**
 * Integration test against the real dev Postgres — resolveOrderItemImageUrl(s)
 * (spec §2's fallback chain: stored snapshot -> live variant image -> live
 * product image -> null/placeholder). Covers the two cases that matter
 * most: a normal snapshot short-circuits without any DB lookup, and a
 * missing/blank snapshot never crashes even when the referenced
 * product/variant no longer exists (OrderItem.productId/variantId are
 * informational, not enforced foreign keys).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { resolveOrderItemImageUrl, resolveOrderItemImageUrls } from "./order-item-image";

const RUN = Date.now();

let sellerId: string;
let productId: string;
let variantId: string;
const cleanupUserIds: string[] = [];

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  const sellerUser = await prisma.user.create({
    data: {
      email: `test-oii-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTOII${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test OII Shop ${RUN}`,
      slug: `test-oii-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test OII Product ${RUN}`,
      slug: `test-oii-product-${RUN}`,
      sku: `TEST-OII-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId: category.id,
      audience: "CUSTOMER_ONLY",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      primaryImageUrl: "/live-product-image.jpg",
      customerConfig: {
        create: { mrp: 200, sellingPrice: 200, minOrderQty: 1, currentStock: 100, weight: 500 },
      },
    },
  });
  productId = product.id;

  const variant = await prisma.productVariant.create({
    data: {
      productId,
      audience: "CUSTOMER",
      combinationKey: `test-oii-combo-${RUN}`,
      sku: `TEST-OII-VARIANT-${RUN}`,
      mrp: 200,
      sellingPrice: 200,
      minOrderQty: 1,
      stockQty: 100,
      weight: 500,
      imageUrl: "/live-variant-image.jpg",
      isActive: true,
    },
  });
  variantId = variant.id;
});

after(async () => {
  await prisma.productVariant.deleteMany({ where: { productId } });
  await prisma.productCustomerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("a present, non-blank snapshot is returned as-is with no DB lookup needed", async () => {
  const url = await resolveOrderItemImageUrl({
    productImageUrl: "/snapshot-image.jpg",
    productId: "does-not-matter",
    variantId: null,
  });
  assert.equal(url, "/snapshot-image.jpg");
});

test("a missing snapshot with a variantId falls back to the live variant image", async () => {
  const url = await resolveOrderItemImageUrl({
    productImageUrl: "",
    productId,
    variantId,
  });
  assert.equal(url, "/live-variant-image.jpg");
});

test("a missing snapshot with no variantId falls back to the live product image", async () => {
  const url = await resolveOrderItemImageUrl({
    productImageUrl: null,
    productId,
    variantId: null,
  });
  assert.equal(url, "/live-product-image.jpg");
});

test("a missing snapshot referencing a product/variant that no longer exists returns null instead of throwing", async () => {
  const url = await resolveOrderItemImageUrl({
    productImageUrl: "",
    productId: "nonexistent-product-id",
    variantId: "nonexistent-variant-id",
  });
  assert.equal(url, null);
});

test("resolveOrderItemImageUrls batches correctly: snapshot items skip the DB, missing ones get the live fallback, keyed by the caller's own key", async () => {
  const result = await resolveOrderItemImageUrls([
    { key: "item-1", productImageUrl: "/already-there.jpg", productId, variantId: null },
    { key: "item-2", productImageUrl: "", productId, variantId },
    { key: "item-3", productImageUrl: undefined, productId: "gone", variantId: null },
  ]);
  assert.equal(result.get("item-1"), "/already-there.jpg");
  assert.equal(result.get("item-2"), "/live-variant-image.jpg");
  assert.equal(result.get("item-3"), null);
});
