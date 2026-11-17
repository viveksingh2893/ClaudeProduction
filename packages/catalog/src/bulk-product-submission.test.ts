/**
 * Integration test against the real dev Postgres — the bulk "Add Multiple
 * Products" draft CRUD + submission engine. Covers: multi-group batch
 * submission, mixed variant/non-variant products in one draft, audience
 * separation, existing-product recall/update, unauthorized access
 * rejection, and idempotent retry (a re-submitted already-succeeded group
 * updates instead of duplicating).
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  createBulkDraft,
  upsertBulkGroup,
  upsertBulkRow,
  getBulkDraft,
  loadExistingProductForBulkRecall,
  type BulkActor,
} from "./bulk-product-draft";
import { submitBulkDraft, validateBulkDraft } from "./bulk-product-submission";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let otherSellerId: string;
let otherSellerUserId: string;
let adminUserId: string;
let categoryId: string;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];
const createdDraftIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE bulk-product ${RUN}`,
      slug: `test-fixture-bulk-product-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-bulk-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Bulk Seller",
      role: "SELLER",
      referralCode: `TESTBULKSELLER${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Bulk Shop ${RUN}`,
      slug: `test-bulk-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const otherUser = await prisma.user.create({
    data: {
      email: `test-bulk-otherseller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Other Seller",
      role: "SELLER",
      referralCode: `TESTBULKOTHER${RUN}`,
    },
  });
  otherSellerUserId = otherUser.id;
  createdUserIds.push(otherSellerUserId);
  const otherProfile = await prisma.sellerProfile.create({
    data: {
      userId: otherSellerUserId,
      shopName: `Test Bulk Other Shop ${RUN}`,
      slug: `test-bulk-other-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  otherSellerId = otherProfile.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `test-bulk-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE Bulk Admin",
      role: "ADMIN",
      referralCode: `TESTBULKADMIN${RUN}`,
    },
  });
  adminUserId = adminUser.id;
  createdUserIds.push(adminUserId);
});

after(async () => {
  for (const id of createdDraftIds) {
    await prisma.bulkProductDraft.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdProductIds) {
    await prisma.productCustomerConfig.delete({ where: { productId: id } }).catch(() => {});
    await prisma.productDealerConfig.delete({ where: { productId: id } }).catch(() => {});
    const variantIds = await prisma.productVariant.findMany({ where: { productId: id }, select: { id: true } });
    await prisma.productVariantValue.deleteMany({ where: { variantId: { in: variantIds.map((v) => v.id) } } });
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.productVariantAttributeValue.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.deleteMany({ where: { id: { in: [sellerId, otherSellerId] } } });
  // Creating a product under a seller triggers a Notification to that
  // seller's user — without deleting these first, prisma.user.delete
  // below fails on Notification_userId_fkey (caught, silent), leaving
  // the fixture user permanently orphaned. Found via a leftover-row audit
  // after this file's own tests ran multiple times this session.
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
});

function sellerActor(): BulkActor {
  return { role: "SELLER", userId: sellerUserId, sellerId };
}
function otherSellerActor(): BulkActor {
  return { role: "SELLER", userId: otherSellerUserId, sellerId: otherSellerId };
}
function adminActor(): BulkActor {
  return { role: "ADMIN", userId: adminUserId };
}

async function addNonVariantGroup(
  draftId: string,
  version: number,
  suffix: string,
  audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER",
) {
  const groupResult = await upsertBulkGroup(sellerActor(), draftId, version, {
    groupKey: `GRP-${suffix}`,
    hasVariants: false,
    audience,
    sharedData: {
      name: `TEST FIXTURE Bulk Product ${suffix}`,
      categoryId,
      baseUnit: "PIECE",
      productType: "PHYSICAL",
      audience,
      shortDescription: "A short description long enough to pass validation.",
      description: "A full description that is definitely long enough to pass the validation rules.",
      primaryImageUrl: "/test/fixture.jpg",
    },
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) throw new Error("group upsert failed");
  const groupId = groupResult.data.id;
  let v = groupResult.data ? (await getVersion(draftId)) : version;

  if (audience === "CUSTOMER_ONLY" || audience === "BOTH_CUSTOMER_AND_DEALER") {
    const r = await upsertBulkRow(sellerActor(), draftId, v, {
      groupId,
      audience: "CUSTOMER",
      rowData: {
        skuBase: `SKU-${suffix}-CUS-BASE`,
        hsnCode: "100100",
        mrp: "100",
        sellingPrice: "90",
        taxPercent: "5",
        minOrderQty: "1",
        currentStock: "20",
        minStockQty: "5",
        reorderLevel: "10",
      },
    });
    assert.equal(r.ok, true);
    v = await getVersion(draftId);
  }
  if (audience === "DEALER_ONLY" || audience === "BOTH_CUSTOMER_AND_DEALER") {
    const r = await upsertBulkRow(sellerActor(), draftId, v, {
      groupId,
      audience: "DEALER",
      rowData: {
        skuBase: `SKU-${suffix}-DEA-BASE`,
        hsnCode: "100100",
        mrp: "95",
        sellingPrice: "85",
        taxPercent: "5",
        minOrderQty: "10",
        currentStock: "50",
        minStockQty: "10",
        reorderLevel: "20",
      },
    });
    assert.equal(r.ok, true);
    v = await getVersion(draftId);
  }
  return { groupId, version: v };
}

async function getVersion(draftId: string): Promise<number> {
  const draft = await prisma.bulkProductDraft.findUniqueOrThrow({ where: { id: draftId } });
  return draft.version;
}

test("creates a multi-group draft (customer-only, dealer-only, both) and submits all groups successfully", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-a`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  await addNonVariantGroup(draftId, 0, `${RUN}-a1`, "CUSTOMER_ONLY");
  await addNonVariantGroup(draftId, await getVersion(draftId), `${RUN}-a2`, "DEALER_ONLY");
  await addNonVariantGroup(draftId, await getVersion(draftId), `${RUN}-a3`, "BOTH_CUSTOMER_AND_DEALER");

  const submission = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  assert.equal(submission.results.length, 3);
  for (const r of submission.results) {
    assert.equal(r.ok, true, `group ${r.groupKey} failed: ${r.error} ${JSON.stringify(r.fieldErrors)}`);
    if (r.productId) createdProductIds.push(r.productId);
  }
});

test("a non-variant product with BOTH audience gets fully separate customer/dealer stock and SKUs", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-b`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  await addNonVariantGroup(draftId, 0, `${RUN}-b1`, "BOTH_CUSTOMER_AND_DEALER");
  const submission = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  const result = submission.results[0]!;
  assert.equal(result.ok, true);
  createdProductIds.push(result.productId!);

  const [customerConfig, dealerConfig] = await Promise.all([
    prisma.productCustomerConfig.findUnique({ where: { productId: result.productId! } }),
    prisma.productDealerConfig.findUnique({ where: { productId: result.productId! } }),
  ]);
  assert.equal(customerConfig?.sku, `SKU-${RUN}-b1-CUS-BASE-cus`);
  assert.equal(dealerConfig?.sku, `SKU-${RUN}-b1-DEA-BASE-dea`);
  assert.equal(customerConfig?.currentStock, 20);
  assert.equal(dealerConfig?.currentStock, 50);
});

test("a variant product generates separate customer/dealer variant rows with independent stock", async () => {
  const attribute = await prisma.productAttribute.create({
    data: { name: `TEST Bulk Size ${RUN}`, slug: `test-bulk-size-${RUN}` },
  });

  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-c`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  const groupResult = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-c1`,
    hasVariants: true,
    audience: "BOTH_CUSTOMER_AND_DEALER",
    sharedData: {
      name: `TEST FIXTURE Bulk Variant Product ${RUN}`,
      categoryId,
      baseUnit: "PIECE",
      productType: "PHYSICAL",
      audience: "BOTH_CUSTOMER_AND_DEALER",
      hasVariants: "YES",
      shortDescription: "A short description long enough to pass validation.",
      description: "A full description that is definitely long enough to pass the validation rules.",
      primaryImageUrl: "/test/fixture.jpg",
      selectedAttributeIds: [attribute.id],
      attributeValues: [
        { attributeId: attribute.id, value: "Large", slug: "large", position: 0, isActive: true },
      ],
    },
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) return;
  const groupId = groupResult.data.id;

  let v = await getVersion(draftId);
  const customerRow = await upsertBulkRow(sellerActor(), draftId, v, {
    groupId,
    audience: "CUSTOMER",
    rowData: {
      attributeValueRefs: [{ attributeId: attribute.id, slug: "large" }],
      skuBase: `SKU-${RUN}-c-VAR`,
      hsnCode: "200200",
      mrp: "500",
      sellingPrice: "450",
      minOrderQty: "1",
      currentStock: "15",
    },
  });
  assert.equal(customerRow.ok, true);
  v = await getVersion(draftId);
  const dealerRow = await upsertBulkRow(sellerActor(), draftId, v, {
    groupId,
    audience: "DEALER",
    rowData: {
      attributeValueRefs: [{ attributeId: attribute.id, slug: "large" }],
      skuBase: `SKU-${RUN}-c-VAR`,
      hsnCode: "200200",
      mrp: "480",
      sellingPrice: "420",
      minOrderQty: "5",
      currentStock: "60",
    },
  });
  assert.equal(dealerRow.ok, true);

  const submission = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  const result = submission.results[0]!;
  assert.equal(result.ok, true, `${result.error} ${JSON.stringify(result.fieldErrors)}`);
  createdProductIds.push(result.productId!);

  const variants = await prisma.productVariant.findMany({ where: { productId: result.productId! } });
  assert.equal(variants.length, 2);
  const cust = variants.find((v2) => v2.audience === "CUSTOMER");
  const deal = variants.find((v2) => v2.audience === "DEALER");
  assert.equal(cust?.sku, `SKU-${RUN}-c-VAR-cus`);
  assert.equal(deal?.sku, `SKU-${RUN}-c-VAR-dea`);
  assert.equal(cust?.stockQty, 15);
  assert.equal(deal?.stockQty, 60);
  assert.equal(cust?.combinationKey, deal?.combinationKey);

  await prisma.productAttribute.delete({ where: { id: attribute.id } }).catch(() => {});
});

test("recalling an existing product and re-submitting the same group updates it instead of creating a duplicate (idempotent retry)", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-d`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  await addNonVariantGroup(draftId, 0, `${RUN}-d1`, "CUSTOMER_ONLY");
  const firstSubmit = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(firstSubmit.ok, true);
  if (!firstSubmit.ok) return;
  const productId = firstSubmit.results[0]!.productId!;
  createdProductIds.push(productId);

  const beforeCount = await prisma.product.count();
  const secondSubmit = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(secondSubmit.ok, true);
  if (!secondSubmit.ok) return;
  assert.equal(secondSubmit.results[0]!.ok, true);
  assert.equal(secondSubmit.results[0]!.productId, productId, "retry must update the SAME product, not create a new one");
  const afterCount = await prisma.product.count();
  assert.equal(afterCount, beforeCount, "no duplicate product created on retry");
});

test("recalling an existing product loads its shared data and rows for the bulk form", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-e`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);
  await addNonVariantGroup(draftId, 0, `${RUN}-e1`, "CUSTOMER_ONLY");
  const submission = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  const productId = submission.results[0]!.productId!;
  createdProductIds.push(productId);

  const recalled = await loadExistingProductForBulkRecall(sellerActor(), productId);
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  assert.equal(recalled.product.hasVariants, false);
  assert.equal(recalled.rows.length, 1);
  assert.equal(recalled.rows[0]!.audience, "CUSTOMER");
  assert.equal(recalled.rows[0]!.rowData.skuBase, `SKU-${RUN}-e1-CUS-BASE-cus`);
});

test("a seller cannot load another seller's product for recall", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-f`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);
  await addNonVariantGroup(draftId, 0, `${RUN}-f1`, "CUSTOMER_ONLY");
  const submission = await submitBulkDraft(sellerActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  const productId = submission.results[0]!.productId!;
  createdProductIds.push(productId);

  const recalled = await loadExistingProductForBulkRecall(otherSellerActor(), productId);
  assert.equal(recalled.ok, false);
});

test("a seller cannot access another seller's draft", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-g`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  const otherView = await getBulkDraft(otherSellerActor(), draftId);
  assert.equal(otherView, null);

  const otherSubmit = await submitBulkDraft(otherSellerActor(), draftId);
  assert.equal(otherSubmit.ok, false);
});

test("a stale draft version is rejected as a conflict instead of silently overwriting", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-h`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  const staleResult = await upsertBulkGroup(sellerActor(), draftId, 999, {
    groupKey: `GRP-${RUN}-h1`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: { name: "Conflict test" },
  });
  assert.equal(staleResult.ok, false);
  if (staleResult.ok) return;
  assert.equal((staleResult as { conflict?: boolean }).conflict, true);
});

test("an admin group with no seller assigned fails only that group, not the whole batch", async () => {
  const draftResult = await createBulkDraft(adminActor(), `TEST bulk admin draft ${RUN}-i`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  const groupResult = await upsertBulkGroup(adminActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-i1`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: {
      name: `TEST FIXTURE Admin Bulk Product ${RUN}`,
      categoryId,
      baseUnit: "PIECE",
      productType: "PHYSICAL",
      audience: "CUSTOMER_ONLY",
      shortDescription: "A short description long enough to pass validation.",
      description: "A full description that is definitely long enough to pass the validation rules.",
      primaryImageUrl: "/test/fixture.jpg",
    },
    // sellerId intentionally omitted — a brand-new admin group needs an
    // explicit seller assignment before it can be created (applyProductSubmission's
    // CREATE contract always requires a real sellerId) — expect a clear
    // per-group error here, not a crash and not a whole-batch abort.
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) return;
  const v = await getVersion(draftId);
  // A row that's otherwise fully valid, so the ONLY reason submission can
  // fail is the missing seller assignment — isolating that check from
  // ordinary field validation.
  const rowResult = await upsertBulkRow(adminActor(), draftId, v, {
    groupId: groupResult.data.id,
    audience: "CUSTOMER",
    rowData: {
      skuBase: `SKU-${RUN}-i1-CUS-BASE`,
      hsnCode: "100100",
      mrp: "100",
      sellingPrice: "90",
      minOrderQty: "1",
      currentStock: "20",
    },
  });
  assert.equal(rowResult.ok, true);

  const validation = await validateBulkDraft(adminActor(), draftId);
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.results[0]!.ok, false);
  assert.ok(validation.results[0]!.fieldErrors?.some((e: string) => e.includes("no seller assigned")));

  const submission = await submitBulkDraft(adminActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  assert.equal(submission.results[0]!.ok, false);
  assert.match(submission.results[0]!.error ?? "", /no seller assigned/);
});

test("an admin assigns a group to a specific seller, and that seller ends up owning the created product", async () => {
  const draftResult = await createBulkDraft(adminActor(), `TEST bulk admin draft ${RUN}-j`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  const groupResult = await upsertBulkGroup(adminActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-j1`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sellerId,
    sharedData: {
      name: `TEST FIXTURE Admin Assigned Bulk Product ${RUN}`,
      categoryId,
      baseUnit: "PIECE",
      productType: "PHYSICAL",
      audience: "CUSTOMER_ONLY",
      shortDescription: "A short description long enough to pass validation.",
      description: "A full description that is definitely long enough to pass the validation rules.",
      primaryImageUrl: "/test/fixture.jpg",
    },
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) return;
  let v = await getVersion(draftId);
  const rowResult = await upsertBulkRow(adminActor(), draftId, v, {
    groupId: groupResult.data.id,
    audience: "CUSTOMER",
    rowData: {
      skuBase: `SKU-${RUN}-j1-CUS-BASE`,
      hsnCode: "100100",
      mrp: "100",
      sellingPrice: "90",
      minOrderQty: "1",
      currentStock: "20",
    },
  });
  assert.equal(rowResult.ok, true);

  const submission = await submitBulkDraft(adminActor(), draftId);
  assert.equal(submission.ok, true);
  if (!submission.ok) return;
  assert.equal(submission.results[0]!.ok, true, `${submission.results[0]!.error} ${JSON.stringify(submission.results[0]!.fieldErrors)}`);
  const productId = submission.results[0]!.productId!;
  createdProductIds.push(productId);

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { sellerId: true } });
  assert.equal(product?.sellerId, sellerId, "the product must be owned by the seller the admin assigned it to");
});

test("a seller-supplied sellerId on a group is ignored — a seller's own draft always creates under themselves", async () => {
  const draftResult = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-k`);
  assert.equal(draftResult.ok, true);
  if (!draftResult.ok) return;
  const draftId = draftResult.data.id;
  createdDraftIds.push(draftId);

  const groupResult = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-k1`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    // Attempting to assign the group to a DIFFERENT seller than the
    // actor themselves — must be silently ignored, never trusted from a
    // seller caller (see upsertBulkGroup's sellerId handling).
    sellerId: otherSellerId,
    sharedData: {
      name: `TEST FIXTURE Seller-Assigned-Ignored Product ${RUN}`,
      categoryId,
      baseUnit: "PIECE",
      productType: "PHYSICAL",
      audience: "CUSTOMER_ONLY",
      shortDescription: "A short description long enough to pass validation.",
      description: "A full description that is definitely long enough to pass the validation rules.",
      primaryImageUrl: "/test/fixture.jpg",
    },
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) return;

  const draft = await getBulkDraft(sellerActor(), draftId);
  assert.equal(draft!.groups[0]!.sellerId, null, "a seller actor's chosen sellerId on a group must never be persisted");
});
