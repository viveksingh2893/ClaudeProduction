/**
 * Integration test against the real dev Postgres — reactivateOwnProduct
 * (packages/catalog/src/product-decisions.ts), the seller-side mirror of
 * deactivateOwnProduct added alongside the seller product review page.
 * Covers: a seller reactivating their own deactivated listing, ownership
 * enforcement, that SUSPENDED (an admin enforcement action) can never be
 * self-lifted by the seller — only INACTIVE (their own deactivation) can
 * — and, separately, that editing a live product can resubmit it for
 * review (APPROVED -> SUBMITTED via lifecycle.ts's new transition,
 * reusing submitProductForApproval unchanged — see
 * apps/dashboard/src/app/seller/products/actions.ts's updateProductAction).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  deactivateOwnProduct,
  reactivateOwnProduct,
  submitProductForApproval,
} from "./product-decisions";

const RUN = Date.now();

let sellerAId: string;
let sellerAUserId: string;
let sellerBId: string;
let sellerBUserId: string;
let categoryId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];

async function createApprovedProduct(sellerId: string, suffix: string): Promise<string> {
  const product = await prisma.product.create({
    data: {
      name: `TEST FIXTURE reactivate ${suffix}`,
      slug: `test-fixture-reactivate-${suffix}`,
      sku: `TEST-REACT-${suffix}`,
      hsnCode: "100100",
      shortDescription: "Regression fixture for reactivateOwnProduct.",
      description: "Regression fixture for reactivateOwnProduct, long enough to pass validation.",
      productType: "PHYSICAL",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      categoryId,
      audience: "CUSTOMER_ONLY",
      customerVisible: true,
      dealerVisible: false,
      primaryImageUrl: "/test/fixture.jpg",
      sellerId,
      lifecycleStatus: "APPROVED",
    },
  });
  createdProductIds.push(product.id);
  return product.id;
}

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE reactivate ${RUN}`,
      slug: `test-fixture-reactivate-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerAUser = await prisma.user.create({
    data: {
      email: `test-react-seller-a-${RUN}@example.com`,
      firstName: "TEST FIXTURE Reactivate Seller A",
      role: "SELLER",
      referralCode: `TESTREACTA${RUN}`,
    },
  });
  sellerAUserId = sellerAUser.id;
  createdUserIds.push(sellerAUserId);
  const sellerAProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerAUserId,
      shopName: `Test Reactivate Shop A ${RUN}`,
      slug: `test-react-shop-a-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerAId = sellerAProfile.id;

  const sellerBUser = await prisma.user.create({
    data: {
      email: `test-react-seller-b-${RUN}@example.com`,
      firstName: "TEST FIXTURE Reactivate Seller B",
      role: "SELLER",
      referralCode: `TESTREACTB${RUN}`,
    },
  });
  sellerBUserId = sellerBUser.id;
  createdUserIds.push(sellerBUserId);
  const sellerBProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerBUserId,
      shopName: `Test Reactivate Shop B ${RUN}`,
      slug: `test-react-shop-b-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerBId = sellerBProfile.id;
});

after(async () => {
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.deleteMany({ where: { id: { in: [sellerAId, sellerBId] } } });
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

test("a seller can deactivate their own approved product and then reactivate it back to approved", async () => {
  const productId = await createApprovedProduct(sellerAId, `${RUN}-a`);

  const deactivated = await deactivateOwnProduct(sellerAId, productId);
  assert.equal(deactivated.ok, true);
  const afterDeactivate = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(afterDeactivate.lifecycleStatus, "INACTIVE");

  const reactivated = await reactivateOwnProduct(sellerAId, productId);
  assert.equal(reactivated.ok, true, !reactivated.ok ? reactivated.error : "");
  const afterReactivate = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(afterReactivate.lifecycleStatus, "APPROVED");
});

test("a seller cannot reactivate another seller's product", async () => {
  const productId = await createApprovedProduct(sellerAId, `${RUN}-b`);
  const deactivated = await deactivateOwnProduct(sellerAId, productId);
  assert.equal(deactivated.ok, true);

  const result = await reactivateOwnProduct(sellerBId, productId);
  assert.equal(result.ok, false);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(product.lifecycleStatus, "INACTIVE");
});

test("a seller cannot self-reactivate a product an admin suspended — only INACTIVE (their own deactivation) is reachable, never SUSPENDED", async () => {
  const productId = await createApprovedProduct(sellerAId, `${RUN}-c`);
  await prisma.product.update({ where: { id: productId }, data: { lifecycleStatus: "SUSPENDED" } });

  const result = await reactivateOwnProduct(sellerAId, productId);
  assert.equal(result.ok, false);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(product.lifecycleStatus, "SUSPENDED");
});

test("a seller's edit-triggered resubmit takes a live (APPROVED) product back to SUBMITTED, pulling it off the storefront until re-reviewed", async () => {
  const productId = await createApprovedProduct(sellerAId, `${RUN}-resubmit`);
  // Completeness (assertProductComplete) requires real pricing for the
  // audience this product needs — createApprovedProduct's fixture has
  // none by itself, so this mirrors what a genuinely complete, live
  // product would already have.
  await prisma.productCustomerConfig.create({
    data: {
      productId,
      sku: `TEST-RESUBMIT-CFG-${RUN}`,
      hsnCode: "100100",
      mrp: 100,
      sellingPrice: 100,
      currentStock: 5,
    },
  });

  const result = await submitProductForApproval(sellerAId, productId);
  assert.equal(result.ok, true, !result.ok ? result.error : "");

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(product.lifecycleStatus, "SUBMITTED");
});
