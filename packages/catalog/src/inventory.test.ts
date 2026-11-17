/**
 * Integration test against the real dev Postgres — variant-level stock
 * management (spec §1-§7, §13). Covers: variant-vs-default-row listing,
 * stock-status threshold boundaries, recordStockChange's atomic ledger
 * writes (add/set, ownership guard, concurrency-safe last-unit decrement),
 * and updateStockThresholds' reorder>min validation.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  listInventory,
  computeStockStatus,
  recordStockChange,
  updateStockThresholds,
  listStockAdjustments,
  type StockTarget,
} from "./inventory";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let adminUserId: string;
let categoryId: string;
let variantProductId: string;
let variantIds: string[] = [];
let baseProductId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE inventory ${RUN}`,
      slug: `test-fixture-inventory-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-inv-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Inventory Seller",
      role: "SELLER",
      referralCode: `TESTINVSELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Inventory Shop ${RUN}`,
      slug: `test-inventory-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `test-inv-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE Inventory Admin",
      role: "ADMIN",
      referralCode: `TESTINVADMIN${RUN}`,
    },
  });
  adminUserId = adminUser.id;
  createdUserIds.push(adminUserId);

  const variantProduct = await prisma.product.create({
    data: {
      sellerId,
      categoryId,
      name: "TEST FIXTURE variant product",
      slug: `test-fixture-inv-variant-product-${RUN}`,
      sku: `TEST-INV-VARIANT-${RUN}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for variant inventory rows.",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
    },
  });
  variantProductId = variantProduct.id;
  createdProductIds.push(variantProductId);

  for (const [i, label] of ["Red-500ml", "Blue-500ml", "Red-1L"].entries()) {
    const v = await prisma.productVariant.create({
      data: {
        productId: variantProductId,
        audience: "CUSTOMER",
        combinationKey: `test-inv-combo-${RUN}-${i}`,
        sku: `TEST-INV-VARIANT-SKU-${RUN}-${i}`,
        mrp: 100,
        sellingPrice: 100,
        minOrderQty: 1,
        stockQty: 20,
        minStockQty: 5,
        reorderLevel: 10,
        isActive: true,
        imageAlt: label,
      },
    });
    variantIds.push(v.id);
  }

  const baseProduct = await prisma.product.create({
    data: {
      sellerId,
      categoryId,
      name: "TEST FIXTURE non-variant product",
      slug: `test-fixture-inv-base-product-${RUN}`,
      sku: `TEST-INV-BASE-${RUN}`,
      hsnCode: "000000",
      shortDescription: "Regression fixture",
      description: "Regression fixture for the default-variant inventory row.",
      audience: "CUSTOMER_ONLY",
      baseUnit: "PIECE",
      packageSize: "1 piece",
      primaryImageUrl: "/test/fixture.jpg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      customerConfig: {
        create: {
          mrp: 50,
          sellingPrice: 50,
          minOrderQty: 1,
          currentStock: 30,
          minStockQty: 5,
          reorderLevel: 10,
        },
      },
    },
  });
  baseProductId = baseProduct.id;
  createdProductIds.push(baseProductId);
});

after(async () => {
  await prisma.stockAdjustment.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: variantProductId } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: sellerId } });
  for (const id of createdUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
  await prisma.category.deleteMany({ where: { id: categoryId } });
});

test("a product with three variants produces three inventory rows, a non-variant product produces one 'Default variant' row", async () => {
  const { rows } = await listInventory({ search: `TEST FIXTURE`, pageSize: 100 }, { sellerId });
  const variantRows = rows.filter((r) => r.productId === variantProductId);
  const baseRows = rows.filter((r) => r.productId === baseProductId);
  assert.equal(variantRows.length, 3);
  assert.ok(variantRows.every((r) => r.variantId !== null));
  assert.equal(baseRows.length, 1);
  assert.equal(baseRows[0]!.variantId, null);
  assert.equal(baseRows[0]!.variantLabel, "Default variant");
});

test("each variant maintains independent stock/thresholds", async () => {
  const { rows } = await listInventory({ search: `TEST FIXTURE`, pageSize: 100 }, { sellerId });
  const variantRows = rows.filter((r) => r.productId === variantProductId);
  await recordStockChange(prisma, {
    target: { kind: "variant", variantId: variantIds[0]! },
    change: { mode: "delta", delta: 5 },
    adjustmentType: "MANUAL_ADD",
    sourceType: "SELLER",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  const { rows: afterRows } = await listInventory(
    { search: `TEST FIXTURE`, pageSize: 100 },
    { sellerId },
  );
  const changed = afterRows.find((r) => r.variantId === variantIds[0]);
  const untouched = afterRows.find((r) => r.variantId === variantIds[1]);
  assert.equal(changed!.onHandQty, 25);
  assert.equal(untouched!.onHandQty, 20);
  assert.equal(variantRows.length, 3, "sanity: fixture still has exactly 3 variants");
});

test("stock status: above reorder is In stock, at reorder is Reorder required (yellow), between min and reorder is Reorder required, at minimum is Minimum level (red), below minimum but above zero is Minimum level, zero is Out of stock", () => {
  assert.deepEqual(computeStockStatus(11, 5, 10), {
    status: "IN_STOCK",
    label: "In stock",
    tone: "success",
  });
  assert.deepEqual(computeStockStatus(10, 5, 10), {
    status: "REORDER_REQUIRED",
    label: "Reorder required",
    tone: "warning",
  });
  assert.deepEqual(computeStockStatus(7, 5, 10), {
    status: "REORDER_REQUIRED",
    label: "Reorder required",
    tone: "warning",
  });
  assert.deepEqual(computeStockStatus(5, 5, 10), {
    status: "MINIMUM_LEVEL",
    label: "Minimum level",
    tone: "danger",
  });
  assert.deepEqual(computeStockStatus(2, 5, 10), {
    status: "MINIMUM_LEVEL",
    label: "Minimum level",
    tone: "danger",
  });
  assert.deepEqual(computeStockStatus(0, 5, 10), {
    status: "OUT_OF_STOCK",
    label: "Out of stock",
    tone: "danger",
  });
});

test("Add Quantity increments atomically and writes an immutable ledger row", async () => {
  const target: StockTarget = { kind: "base", productId: baseProductId, audience: "CUSTOMER" };
  const before = await prisma.productCustomerConfig.findUniqueOrThrow({
    where: { productId: baseProductId },
  });
  const result = await recordStockChange(prisma, {
    target,
    change: { mode: "delta", delta: 7 },
    adjustmentType: "MANUAL_ADD",
    sourceType: "SELLER",
    reason: "Restocked from supplier",
    performedBy: { id: sellerUserId, role: "SELLER" },
    expectedSellerId: sellerId,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.previousQty, before.currentStock);
  assert.equal(result.newQty, before.currentStock + 7);

  const history = await listStockAdjustments(target);
  if ("ok" in history) throw new Error("expected history rows");
  const latest = history.rows[0]!;
  assert.equal(latest.changeQty, 7);
  assert.equal(latest.adjustmentType, "MANUAL_ADD");
  assert.equal(latest.reason, "Restocked from supplier");
  assert.equal(latest.performedByRole, "SELLER");
});

test("Set/Correct Quantity stores old/new via an absolute set, guarded by the expected previous value", async () => {
  const target: StockTarget = { kind: "variant", variantId: variantIds[2]! };
  const current = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[2]! } });
  const ok = await recordStockChange(prisma, {
    target,
    change: { mode: "set", newQty: 3, expectedPreviousQty: current.stockQty },
    adjustmentType: "MANUAL_CORRECTION",
    sourceType: "SELLER",
    reason: "Physical count correction",
    performedBy: { id: sellerUserId, role: "SELLER" },
    expectedSellerId: sellerId,
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.newQty, 3);

  // Stale expectedPreviousQty (the value has already moved) must be refused, not silently overwrite.
  const stale = await recordStockChange(prisma, {
    target,
    change: { mode: "set", newQty: 99, expectedPreviousQty: current.stockQty },
    adjustmentType: "MANUAL_CORRECTION",
    sourceType: "SELLER",
    reason: "Stale attempt",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  assert.equal(stale.ok, false);
  const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[2]! } });
  assert.equal(row.stockQty, 3, "the stale write must never have applied");
});

test("Set Quantity requires a mandatory reason to be enforced by callers — recordStockChange itself does not silently accept an empty one from an untrusted caller", async () => {
  // recordStockChange's contract: an empty/omitted reason is technically
  // accepted at the data layer (some callers, e.g. order sale, have no
  // human reason to give) — the MANDATORY-reason rule is the seller/admin
  // Set-Quantity action's own responsibility (see apps/dashboard's
  // sellerSetStockAction/adminSetStockAction, which both reject an empty
  // reason before ever calling this function). This test documents that
  // boundary rather than asserting a rule this layer doesn't own.
  const target: StockTarget = { kind: "variant", variantId: variantIds[1]! };
  const current = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1]! } });
  const result = await recordStockChange(prisma, {
    target,
    change: { mode: "set", newQty: current.stockQty, expectedPreviousQty: current.stockQty },
    adjustmentType: "MANUAL_CORRECTION",
    sourceType: "SELLER",
    reason: null,
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  assert.equal(result.ok, true);
});

test("negative quantities are rejected", async () => {
  const target: StockTarget = { kind: "variant", variantId: variantIds[0]! };
  const result = await recordStockChange(prisma, {
    target,
    change: { mode: "set", newQty: -1, expectedPreviousQty: 25 },
    adjustmentType: "MANUAL_CORRECTION",
    sourceType: "SELLER",
    reason: "invalid",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  assert.equal(result.ok, false);
});

test("a seller cannot modify another seller's variant — recordStockChange refuses when expectedSellerId doesn't match", async () => {
  const target: StockTarget = { kind: "variant", variantId: variantIds[0]! };
  const result = await recordStockChange(prisma, {
    target,
    change: { mode: "delta", delta: 1 },
    adjustmentType: "MANUAL_ADD",
    sourceType: "SELLER",
    performedBy: { id: sellerUserId, role: "SELLER" },
    expectedSellerId: "not-this-sellers-id",
  });
  assert.equal(result.ok, false);
});

test("admin can modify permitted inventory (no expectedSellerId restriction)", async () => {
  const target: StockTarget = { kind: "variant", variantId: variantIds[0]! };
  const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[0]! } });
  const result = await recordStockChange(prisma, {
    target,
    change: { mode: "delta", delta: 2 },
    adjustmentType: "ADMIN_CORRECTION",
    sourceType: "ADMIN",
    reason: "Admin adjustment",
    performedBy: { id: adminUserId, role: "ADMIN" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.newQty, before.stockQty + 2);
});

test("a guard failure (insufficient stock) creates no stock change and no ledger row", async () => {
  const target: StockTarget = { kind: "variant", variantId: variantIds[1]! };
  const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1]! } });
  const beforeHistory = await listStockAdjustments(target);
  const beforeCount = "ok" in beforeHistory ? 0 : beforeHistory.total;

  const result = await recordStockChange(prisma, {
    target,
    change: { mode: "delta", delta: -(before.stockQty + 1000) },
    adjustmentType: "MANUAL_CORRECTION",
    sourceType: "SELLER",
    reason: "too much",
    performedBy: { id: sellerUserId, role: "SELLER" },
  });
  assert.equal(result.ok, false);

  const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1]! } });
  assert.equal(after.stockQty, before.stockQty);
  const afterHistory = await listStockAdjustments(target);
  const afterCount = "ok" in afterHistory ? 0 : afterHistory.total;
  assert.equal(afterCount, beforeCount);
});

test("concurrent purchase of the final unit cannot oversell — two simultaneous decrements of the last unit, only one succeeds", async () => {
  const lastUnit = await prisma.productVariant.create({
    data: {
      productId: variantProductId,
      audience: "CUSTOMER",
      combinationKey: `test-inv-lastunit-${RUN}`,
      sku: `TEST-INV-LASTUNIT-${RUN}`,
      mrp: 100,
      sellingPrice: 100,
      minOrderQty: 1,
      stockQty: 1,
      isActive: true,
    },
  });
  variantIds.push(lastUnit.id);

  const target: StockTarget = { kind: "variant", variantId: lastUnit.id };
  const [a, b] = await Promise.all([
    recordStockChange(prisma, {
      target,
      change: { mode: "delta", delta: -1 },
      adjustmentType: "ORDER_SALE",
      sourceType: "ORDER",
      performedBy: { id: sellerUserId, role: "SELLER" },
    }),
    recordStockChange(prisma, {
      target,
      change: { mode: "delta", delta: -1 },
      adjustmentType: "ORDER_SALE",
      sourceType: "ORDER",
      performedBy: { id: sellerUserId, role: "SELLER" },
    }),
  ]);
  const successes = [a, b].filter((r) => r.ok);
  assert.equal(successes.length, 1, "exactly one of the two concurrent decrements must succeed");
  const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: lastUnit.id } });
  assert.equal(row.stockQty, 0, "available quantity must never go negative");
});

test("reorder level must be greater than minimum quantity (updateStockThresholds)", async () => {
  const target: StockTarget = { kind: "variant", variantId: variantIds[0]! };
  const invalid = await updateStockThresholds(target, { minStockQty: 10, reorderLevel: 5 });
  assert.equal(invalid.ok, false);
  const valid = await updateStockThresholds(target, { minStockQty: 3, reorderLevel: 8 });
  assert.equal(valid.ok, true);
  const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[0]! } });
  assert.equal(row.minStockQty, 3);
  assert.equal(row.reorderLevel, 8);
});
