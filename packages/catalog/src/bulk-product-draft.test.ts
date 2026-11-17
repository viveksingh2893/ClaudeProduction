/**
 * Integration test against the real dev Postgres — the bulk draft CRUD
 * layer itself (bulk-product-draft.ts), covering the operations
 * bulk-product-submission.test.ts doesn't exercise: rename, delete
 * (with cascade), duplicate (with existingProductId/existingVariantId
 * reset), deleteGroup/deleteRow (with version bump + conflict), list
 * scoping, and cross-actor access denial on every mutation.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  createBulkDraft,
  renameBulkDraft,
  deleteBulkDraft,
  duplicateBulkDraft,
  listBulkDrafts,
  getBulkDraft,
  upsertBulkGroup,
  deleteBulkGroup,
  upsertBulkRow,
  deleteBulkRow,
  type BulkActor,
} from "./bulk-product-draft";

const RUN = Date.now();

let sellerId: string;
let sellerUserId: string;
let otherSellerId: string;
let otherSellerUserId: string;
let adminUserId: string;
let categoryId: string;

const createdUserIds: string[] = [];
const createdDraftIds: string[] = [];

before(async () => {
  const category = await prisma.category.create({
    data: {
      name: `TEST FIXTURE bulk-draft-crud ${RUN}`,
      slug: `test-fixture-bulk-draft-crud-${RUN}`,
      isActive: false,
    },
  });
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-bulk-crud-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Bulk CRUD Seller",
      role: "SELLER",
      referralCode: `TESTBULKCRUDSEL${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  createdUserIds.push(sellerUserId);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUserId,
      shopName: `Test Bulk CRUD Shop ${RUN}`,
      slug: `test-bulk-crud-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const otherUser = await prisma.user.create({
    data: {
      email: `test-bulk-crud-other-${RUN}@example.com`,
      firstName: "TEST FIXTURE Bulk CRUD Other Seller",
      role: "SELLER",
      referralCode: `TESTBULKCRUDOTHER${RUN}`,
    },
  });
  otherSellerUserId = otherUser.id;
  createdUserIds.push(otherSellerUserId);
  const otherProfile = await prisma.sellerProfile.create({
    data: {
      userId: otherSellerUserId,
      shopName: `Test Bulk CRUD Other Shop ${RUN}`,
      slug: `test-bulk-crud-other-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  otherSellerId = otherProfile.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `test-bulk-crud-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE Bulk CRUD Admin",
      role: "ADMIN",
      referralCode: `TESTBULKCRUDADMIN${RUN}`,
    },
  });
  adminUserId = adminUser.id;
  createdUserIds.push(adminUserId);
});

after(async () => {
  for (const id of createdDraftIds) {
    await prisma.bulkProductDraft.delete({ where: { id } }).catch(() => {});
  }
  await prisma.sellerProfile.deleteMany({ where: { id: { in: [sellerId, otherSellerId] } } });
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

async function freshDraft(suffix: string) {
  const result = await createBulkDraft(sellerActor(), `TEST bulk draft ${RUN}-${suffix}`);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("draft creation failed");
  createdDraftIds.push(result.data.id);
  return result.data.id;
}

async function freshAdminDraft(suffix: string) {
  const result = await createBulkDraft(adminActor(), `TEST bulk admin draft ${RUN}-${suffix}`);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("draft creation failed");
  createdDraftIds.push(result.data.id);
  return result.data.id;
}

test("renameBulkDraft updates the name and is rejected for a non-owning seller", async () => {
  const draftId = await freshDraft("rename");
  const renamed = await renameBulkDraft(sellerActor(), draftId, "New name");
  assert.equal(renamed.ok, true);
  const draft = await getBulkDraft(sellerActor(), draftId);
  assert.equal(draft?.name, "New name");

  const deniedRename = await renameBulkDraft(otherSellerActor(), draftId, "Hijacked");
  assert.equal(deniedRename.ok, false);
  const stillMine = await getBulkDraft(sellerActor(), draftId);
  assert.equal(stillMine?.name, "New name");
});

test("listBulkDrafts only returns drafts owned by the calling actor", async () => {
  const mineId = await freshDraft("list-mine");
  const theirsResult = await createBulkDraft(otherSellerActor(), `TEST bulk draft ${RUN}-list-theirs`);
  assert.equal(theirsResult.ok, true);
  if (!theirsResult.ok) return;
  createdDraftIds.push(theirsResult.data.id);

  const mine = await listBulkDrafts(sellerActor());
  const theirs = await listBulkDrafts(otherSellerActor());
  assert.ok(mine.some((d) => d.id === mineId));
  assert.ok(!mine.some((d) => d.id === theirsResult.data.id));
  assert.ok(theirs.some((d) => d.id === theirsResult.data.id));
  assert.ok(!theirs.some((d) => d.id === mineId));
});

test("deleteBulkDraft removes the draft and cascades to its groups/rows, and is rejected for a non-owning seller", async () => {
  const draftId = await freshDraft("delete");
  const groupResult = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-del`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: { name: "To be deleted" },
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) return;

  const deniedDelete = await deleteBulkDraft(otherSellerActor(), draftId);
  assert.equal(deniedDelete.ok, false);
  assert.ok(await getBulkDraft(sellerActor(), draftId), "draft must still exist after a denied cross-seller delete");

  const deleted = await deleteBulkDraft(sellerActor(), draftId);
  assert.equal(deleted.ok, true);
  assert.equal(await getBulkDraft(sellerActor(), draftId), null);
  const orphanGroups = await prisma.bulkProductGroup.findMany({ where: { draftId } });
  assert.equal(orphanGroups.length, 0, "groups must cascade-delete with the draft");
  createdDraftIds.splice(createdDraftIds.indexOf(draftId), 1);
});

test("duplicateBulkDraft copies groups/rows into a new draft and clears existingProductId/existingVariantId", async () => {
  const draftId = await freshDraft("dup-source");
  const groupResult = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-dup`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: { name: "Dup source product" },
  });
  assert.equal(groupResult.ok, true);
  if (!groupResult.ok) return;
  const groupId = groupResult.data.id;

  const rowResult = await upsertBulkRow(sellerActor(), draftId, await currentVersion(draftId), {
    groupId,
    audience: "CUSTOMER",
    rowData: { skuBase: "DUP-SKU", mrp: "10", sellingPrice: "10" },
  });
  assert.equal(rowResult.ok, true);

  // Simulate this group/row having already been submitted once, so the
  // duplicate must NOT inherit those pointers (spec: a duplicated draft
  // always represents new, unsubmitted products).
  await prisma.bulkProductGroup.update({ where: { id: groupId }, data: { existingProductId: "fake-product-id" } });
  if (rowResult.ok) {
    await prisma.bulkProductRow.update({
      where: { id: rowResult.data.id },
      data: { existingVariantId: "fake-variant-id" },
    });
  }

  const dupResult = await duplicateBulkDraft(sellerActor(), draftId);
  assert.equal(dupResult.ok, true);
  if (!dupResult.ok) return;
  createdDraftIds.push(dupResult.data.id);

  const dup = await getBulkDraft(sellerActor(), dupResult.data.id);
  assert.ok(dup);
  assert.equal(dup!.groups.length, 1);
  assert.equal(dup!.groups[0]!.groupKey, `GRP-${RUN}-dup`);
  assert.equal(dup!.groups[0]!.existingProductId, null, "duplicate must not point at the source's live product");
  assert.equal(dup!.groups[0]!.rows.length, 1);
  assert.equal(dup!.groups[0]!.rows[0]!.existingVariantId, null, "duplicate row must not point at the source's variant");

  const deniedDup = await duplicateBulkDraft(otherSellerActor(), draftId);
  assert.equal(deniedDup.ok, false);
});

test("deleteBulkGroup removes only that group, bumps the version, and rejects a stale version", async () => {
  const draftId = await freshDraft("delgroup");
  const g1 = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-g1`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: { name: "Group 1" },
  });
  assert.equal(g1.ok, true);
  if (!g1.ok) return;
  let v = await currentVersion(draftId);
  const g2 = await upsertBulkGroup(sellerActor(), draftId, v, {
    groupKey: `GRP-${RUN}-g2`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: { name: "Group 2" },
  });
  assert.equal(g2.ok, true);
  if (!g2.ok) return;
  v = await currentVersion(draftId);

  const staleDelete = await deleteBulkGroup(sellerActor(), draftId, v - 1, g1.data.id);
  assert.equal(staleDelete.ok, false);
  assert.equal((staleDelete as { conflict?: boolean }).conflict, true);

  const deleted = await deleteBulkGroup(sellerActor(), draftId, v, g1.data.id);
  assert.equal(deleted.ok, true);

  const draft = await getBulkDraft(sellerActor(), draftId);
  assert.equal(draft!.groups.length, 1);
  assert.equal(draft!.groups[0]!.id, g2.data.id);
  assert.equal(draft!.version, v + 1);
});

test("deleteBulkRow removes only that row and leaves its sibling group intact", async () => {
  const draftId = await freshDraft("delrow");
  const g = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-rowparent`,
    hasVariants: false,
    audience: "BOTH_CUSTOMER_AND_DEALER",
    sharedData: { name: "Row parent" },
  });
  assert.equal(g.ok, true);
  if (!g.ok) return;
  let v = await currentVersion(draftId);
  const custRow = await upsertBulkRow(sellerActor(), draftId, v, {
    groupId: g.data.id,
    audience: "CUSTOMER",
    rowData: { skuBase: "ROW-CUS", mrp: "10", sellingPrice: "10" },
  });
  assert.equal(custRow.ok, true);
  if (!custRow.ok) return;
  v = await currentVersion(draftId);
  const dealRow = await upsertBulkRow(sellerActor(), draftId, v, {
    groupId: g.data.id,
    audience: "DEALER",
    rowData: { skuBase: "ROW-DEA", mrp: "9", sellingPrice: "9" },
  });
  assert.equal(dealRow.ok, true);
  if (!dealRow.ok) return;
  v = await currentVersion(draftId);

  const deniedDelete = await deleteBulkRow(otherSellerActor(), draftId, v, custRow.data.id);
  assert.equal(deniedDelete.ok, false);

  const deleted = await deleteBulkRow(sellerActor(), draftId, v, custRow.data.id);
  assert.equal(deleted.ok, true);

  const draft = await getBulkDraft(sellerActor(), draftId);
  assert.equal(draft!.groups[0]!.rows.length, 1);
  assert.equal(draft!.groups[0]!.rows[0]!.id, dealRow.data.id);
});

test("upsertBulkGroup rejects a duplicate groupKey within the same draft", async () => {
  const draftId = await freshDraft("dupkey");
  const first = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-samekey`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sharedData: { name: "First" },
  });
  assert.equal(first.ok, true);
  const v = await currentVersion(draftId);
  // The clash check throws inside withDraftVersion's transaction (unlike
  // the version-conflict check, which returns a typed {ok:false} before
  // ever opening a transaction) — the promise rejects rather than
  // resolving to {ok:false}. The grid's own saveDraft() catch block
  // handles this the same way it handles a typed failure (see
  // BulkProductGrid.tsx's saveDraft), so this is a real, already-handled
  // behavior, just asserted here directly against the catalog function.
  await assert.rejects(() =>
    upsertBulkGroup(sellerActor(), draftId, v, {
      groupKey: `GRP-${RUN}-samekey`,
      hasVariants: false,
      audience: "CUSTOMER_ONLY",
      sharedData: { name: "Second" },
    }),
  );
  // The failed attempt must not have bumped the draft version or left a
  // second group behind.
  const draft = await getBulkDraft(sellerActor(), draftId);
  assert.equal(draft!.groups.length, 1);
  assert.equal(draft!.version, v);
});

test("an admin can assign a group to a valid approved seller", async () => {
  const draftId = await freshAdminDraft("assign-ok");
  const result = await upsertBulkGroup(adminActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-assign-ok`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sellerId,
    sharedData: { name: "Assigned to a seller" },
  });
  assert.equal(result.ok, true);
  const draft = await getBulkDraft(adminActor(), draftId);
  assert.equal(draft!.groups[0]!.sellerId, sellerId);
});

test("assigning a group to a nonexistent/unapproved seller is rejected", async () => {
  const draftId = await freshAdminDraft("assign-bad");
  await assert.rejects(() =>
    upsertBulkGroup(adminActor(), draftId, 0, {
      groupKey: `GRP-${RUN}-assign-bad`,
      hasVariants: false,
      audience: "CUSTOMER_ONLY",
      sellerId: "not-a-real-seller-id",
      sharedData: { name: "Bad assignment" },
    }),
  );
  const draft = await getBulkDraft(adminActor(), draftId);
  assert.equal(draft!.groups.length, 0, "the rejected group must not have been created");
});

test("a seller actor cannot assign a group's sellerId — it is always forced to null", async () => {
  const draftId = await freshDraft("assign-ignored");
  const result = await upsertBulkGroup(sellerActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-assign-ignored`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sellerId: otherSellerId,
    sharedData: { name: "Should not be assignable by a seller" },
  });
  assert.equal(result.ok, true);
  const draft = await getBulkDraft(sellerActor(), draftId);
  assert.equal(draft!.groups[0]!.sellerId, null);
});

test("duplicateBulkDraft carries the seller assignment forward, unlike existingProductId", async () => {
  const draftId = await freshAdminDraft("dup-seller");
  const g = await upsertBulkGroup(adminActor(), draftId, 0, {
    groupKey: `GRP-${RUN}-dup-seller`,
    hasVariants: false,
    audience: "CUSTOMER_ONLY",
    sellerId,
    sharedData: { name: "Carries seller on duplicate" },
  });
  assert.equal(g.ok, true);

  const dupResult = await duplicateBulkDraft(adminActor(), draftId);
  assert.equal(dupResult.ok, true);
  if (!dupResult.ok) return;
  createdDraftIds.push(dupResult.data.id);
  const dup = await getBulkDraft(adminActor(), dupResult.data.id);
  assert.equal(dup!.groups[0]!.sellerId, sellerId);
});

async function currentVersion(draftId: string): Promise<number> {
  const draft = await prisma.bulkProductDraft.findUniqueOrThrow({ where: { id: draftId } });
  return draft.version;
}
