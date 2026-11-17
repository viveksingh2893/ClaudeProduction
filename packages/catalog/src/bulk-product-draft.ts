import { prisma } from "@kisan4u/db";
import {
  parseBulkGroupSharedData,
  parseBulkRowData,
  type BulkGroupSharedDataInput,
  type BulkRowDataInput,
} from "@kisan4u/validators";
import { assertOwnsProduct } from "./ownership";

/**
 * Draft CRUD for the "Add Multiple Products" spreadsheet — every
 * mutation goes through here, never a raw prisma call from a server
 * action, so the permission scoping and optimistic-concurrency check
 * (spec: "Safely handle two browser tabs editing the same draft") can
 * never accidentally be skipped by a new call site.
 *
 * Scoping: a seller sees/edits only drafts with their own sellerId. An
 * admin sees/edits only drafts they themselves created (createdByUserId)
 * — a deliberate, simple interpretation of "Admin access follows current
 * rules": nothing elsewhere in this codebase has admins sharing/editing
 * each other's in-progress work, so a bulk draft doesn't either.
 */

export type BulkActor =
  | { role: "SELLER"; userId: string; sellerId: string }
  | { role: "ADMIN"; userId: string };

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function draftOwnerWhere(actor: BulkActor) {
  return actor.role === "SELLER" ? { sellerId: actor.sellerId } : { createdByUserId: actor.userId };
}

async function loadOwnedDraft(actor: BulkActor, draftId: string) {
  const draft = await prisma.bulkProductDraft.findUnique({ where: { id: draftId } });
  if (!draft) return null;
  if (actor.role === "SELLER" && draft.sellerId !== actor.sellerId) return null;
  if (actor.role === "ADMIN" && draft.createdByUserId !== actor.userId) return null;
  return draft;
}

export type BulkDraftSummary = {
  id: string;
  name: string;
  status: string;
  groupCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function listBulkDrafts(actor: BulkActor): Promise<BulkDraftSummary[]> {
  const drafts = await prisma.bulkProductDraft.findMany({
    where: { ...draftOwnerWhere(actor), status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { groups: true } } },
  });
  return drafts.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    groupCount: d._count.groups,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export async function createBulkDraft(
  actor: BulkActor,
  name: string,
): Promise<Result<{ id: string }>> {
  const draft = await prisma.bulkProductDraft.create({
    data: {
      name: name.trim() || "Untitled draft",
      sellerId: actor.role === "SELLER" ? actor.sellerId : null,
      createdByUserId: actor.userId,
    },
  });
  return { ok: true, data: { id: draft.id } };
}

export async function renameBulkDraft(
  actor: BulkActor,
  draftId: string,
  name: string,
): Promise<Result> {
  const draft = await loadOwnedDraft(actor, draftId);
  if (!draft) return { ok: false, error: "Draft not found." };
  await prisma.bulkProductDraft.update({
    where: { id: draftId },
    data: { name: name.trim() || "Untitled draft" },
  });
  return { ok: true };
}

/** Required confirmation is a UI-level step (spec: "Require confirmation before deletion") — this is the actual delete, cascades to every group/row via the schema's onDelete: Cascade. Never removes any already-submitted real Product/ProductVariant row — those are entirely separate tables. */
export async function deleteBulkDraft(actor: BulkActor, draftId: string): Promise<Result> {
  const draft = await loadOwnedDraft(actor, draftId);
  if (!draft) return { ok: false, error: "Draft not found." };
  await prisma.bulkProductDraft.delete({ where: { id: draftId } });
  return { ok: true };
}

export async function duplicateBulkDraft(
  actor: BulkActor,
  draftId: string,
): Promise<Result<{ id: string }>> {
  const source = await prisma.bulkProductDraft.findUnique({
    where: { id: draftId },
    include: { groups: { include: { rows: true } } },
  });
  if (!source) return { ok: false, error: "Draft not found." };
  if (actor.role === "SELLER" && source.sellerId !== actor.sellerId)
    return { ok: false, error: "Draft not found." };
  if (actor.role === "ADMIN" && source.createdByUserId !== actor.userId)
    return { ok: false, error: "Draft not found." };

  const created = await prisma.bulkProductDraft.create({
    data: {
      name: `${source.name} (copy)`,
      sellerId: source.sellerId,
      createdByUserId: actor.userId,
      groups: {
        create: source.groups.map((g) => ({
          groupKey: g.groupKey,
          // A duplicated group is always a NEW product, never silently
          // pointed at the same live product the source group represented
          // (spec: "Duplicate the product as a new product" is itself one
          // of the three explicit user choices for an existing product —
          // duplicating a draft must not make that choice FOR the user).
          existingProductId: null,
          hasVariants: g.hasVariants,
          audience: g.audience,
          // Unlike existingProductId, the seller assignment is carried
          // over as-is — it's a genuine "who is this for" decision, not a
          // pointer to the source's live product, so there's no reason to
          // discard it on duplicate.
          sellerId: g.sellerId,
          sharedData: g.sharedData as object,
          position: g.position,
          rows: {
            create: g.rows.map((r) => ({
              audience: r.audience,
              existingVariantId: null,
              rowData: r.rowData as object,
              position: r.position,
            })),
          },
        })),
      },
    },
  });
  return { ok: true, data: { id: created.id } };
}

export type BulkDraftDetail = Awaited<ReturnType<typeof getBulkDraft>>;

export async function getBulkDraft(actor: BulkActor, draftId: string) {
  const draft = await loadOwnedDraft(actor, draftId);
  if (!draft) return null;
  const groups = await prisma.bulkProductGroup.findMany({
    where: { draftId },
    orderBy: { position: "asc" },
    include: { rows: { orderBy: { position: "asc" } } },
  });
  return { ...draft, groups };
}

type ConcurrencyResult<T = undefined> = Result<T> | { ok: false; error: string; conflict: true };

async function withDraftVersion<T>(
  actor: BulkActor,
  draftId: string,
  expectedVersion: number,
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<ConcurrencyResult<T>> {
  const draft = await loadOwnedDraft(actor, draftId);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.version !== expectedVersion) {
    return {
      ok: false,
      error: "This draft changed in another tab or window — reload to see the latest version.",
      conflict: true,
    };
  }
  const data = await prisma.$transaction(async (tx) => {
    const result = await fn(tx);
    await tx.bulkProductDraft.update({
      where: { id: draftId },
      data: { version: { increment: 1 } },
    });
    return result;
  });
  return { ok: true, data } as ConcurrencyResult<T>;
}

/** Create (groupId absent) or update (present) one Product Group's shared/anchor-row data. */
export async function upsertBulkGroup(
  actor: BulkActor,
  draftId: string,
  expectedVersion: number,
  input: {
    groupId?: string;
    groupKey: string;
    hasVariants: boolean;
    audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER" | null;
    sharedData: BulkGroupSharedDataInput;
    /**
     * Which seller this group's product belongs to — an admin-only choice
     * (a seller draft's groups always belong to that seller; there is
     * nothing to pick). Ignored/forced to null for a SELLER actor even if
     * somehow passed, so a seller can never assign their own draft's
     * groups to a different seller.
     */
    sellerId?: string | null;
  },
): Promise<ConcurrencyResult<{ id: string }>> {
  const parsedShared = parseBulkGroupSharedData(input.sharedData);
  const sellerId = actor.role === "ADMIN" ? (input.sellerId ?? null) : null;
  return withDraftVersion(actor, draftId, expectedVersion, async (tx) => {
    if (sellerId) {
      const seller = await tx.sellerProfile.findUnique({ where: { id: sellerId }, select: { status: true } });
      if (!seller || seller.status !== "APPROVED") throw new Error("Selected seller is not a valid approved seller.");
    }
    if (input.groupId) {
      const existing = await tx.bulkProductGroup.findUnique({ where: { id: input.groupId } });
      if (!existing || existing.draftId !== draftId) throw new Error("Group not found in this draft.");
      await tx.bulkProductGroup.update({
        where: { id: input.groupId },
        data: {
          groupKey: input.groupKey,
          hasVariants: input.hasVariants,
          audience: input.audience,
          sharedData: parsedShared,
          sellerId,
        },
      });
      return { id: input.groupId };
    }
    const clash = await tx.bulkProductGroup.findFirst({
      where: { draftId, groupKey: input.groupKey },
    });
    if (clash) throw new Error(`Product Group ID "${input.groupKey}" is already used in this draft.`);
    const maxPosition = await tx.bulkProductGroup.aggregate({
      where: { draftId },
      _max: { position: true },
    });
    const created = await tx.bulkProductGroup.create({
      data: {
        draftId,
        groupKey: input.groupKey,
        hasVariants: input.hasVariants,
        audience: input.audience,
        sharedData: parsedShared,
        sellerId,
        position: (maxPosition._max.position ?? 0) + 1,
      },
    });
    return { id: created.id };
  });
}

export async function deleteBulkGroup(
  actor: BulkActor,
  draftId: string,
  expectedVersion: number,
  groupId: string,
): Promise<ConcurrencyResult> {
  return withDraftVersion(actor, draftId, expectedVersion, async (tx) => {
    const existing = await tx.bulkProductGroup.findUnique({ where: { id: groupId } });
    if (!existing || existing.draftId !== draftId) throw new Error("Group not found in this draft.");
    await tx.bulkProductGroup.delete({ where: { id: groupId } });
  });
}

export async function upsertBulkRow(
  actor: BulkActor,
  draftId: string,
  expectedVersion: number,
  input: {
    rowId?: string;
    groupId: string;
    audience: "CUSTOMER" | "DEALER";
    rowData: BulkRowDataInput;
    /** Set when this row was populated via the "recall existing product" flow — see loadExistingProductForBulkRecall — so the submission engine updates the real ProductVariant instead of creating a duplicate. Never changed on an update-in-place call (undefined leaves whatever was already stored); only meaningful at row-creation time. */
    existingVariantId?: string | null;
  },
): Promise<ConcurrencyResult<{ id: string }>> {
  const parsedRow = parseBulkRowData(input.rowData);
  return withDraftVersion(actor, draftId, expectedVersion, async (tx) => {
    const group = await tx.bulkProductGroup.findUnique({ where: { id: input.groupId } });
    if (!group || group.draftId !== draftId) throw new Error("Group not found in this draft.");

    if (input.rowId) {
      const existing = await tx.bulkProductRow.findUnique({ where: { id: input.rowId } });
      if (!existing || existing.groupId !== input.groupId) throw new Error("Row not found in this group.");
      await tx.bulkProductRow.update({
        where: { id: input.rowId },
        data: {
          audience: input.audience,
          rowData: parsedRow,
          ...(input.existingVariantId !== undefined ? { existingVariantId: input.existingVariantId } : {}),
        },
      });
      return { id: input.rowId };
    }
    const maxPosition = await tx.bulkProductRow.aggregate({
      where: { groupId: input.groupId },
      _max: { position: true },
    });
    const created = await tx.bulkProductRow.create({
      data: {
        groupId: input.groupId,
        audience: input.audience,
        rowData: parsedRow,
        existingVariantId: input.existingVariantId ?? null,
        position: (maxPosition._max.position ?? 0) + 1,
      },
    });
    return { id: created.id };
  });
}

export async function deleteBulkRow(
  actor: BulkActor,
  draftId: string,
  expectedVersion: number,
  rowId: string,
): Promise<ConcurrencyResult> {
  return withDraftVersion(actor, draftId, expectedVersion, async (tx) => {
    const existing = await tx.bulkProductRow.findUnique({ where: { id: rowId } });
    if (!existing) throw new Error("Row not found.");
    const group = await tx.bulkProductGroup.findUnique({ where: { id: existing.groupId } });
    if (!group || group.draftId !== draftId) throw new Error("Row not found in this draft.");
    await tx.bulkProductRow.delete({ where: { id: rowId } });
  });
}

export type ExistingProductForRecall = {
  ok: true;
  product: {
    id: string;
    name: string;
    hasVariants: boolean;
    sharedData: BulkGroupSharedDataInput;
    audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";
  };
  rows: Array<{ variantId: string | null; audience: "CUSTOMER" | "DEALER"; rowData: BulkRowDataInput }>;
};

/**
 * Loads an already-saved product's shared+row data in exactly the shape a
 * BulkProductGroup/BulkProductRow expects, for the "Product Group ID
 * matches an existing product" recall flow. Read-only — writes nothing;
 * the caller (a server action) turns this into upsertBulkGroup/
 * upsertBulkRow calls once the seller/admin confirms what they want to do
 * with it (spec: "Ask whether the user intends to... Do not silently
 * overwrite a live product").
 */
export async function loadExistingProductForBulkRecall(
  actor: BulkActor,
  productId: string,
): Promise<ExistingProductForRecall | { ok: false; error: string }> {
  if (actor.role === "SELLER") {
    const owns = await assertOwnsProduct(actor.sellerId, productId);
    if (!owns.ok) return { ok: false, error: owns.error };
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      customerConfig: true,
      dealerConfig: true,
      variants: { include: { values: { include: { attributeValue: true } } } },
      variantAttributeValues: true,
      images: { orderBy: { position: "asc" } },
      customerAvailableStates: { select: { id: true } },
      dealerAvailableStates: { select: { id: true } },
    },
  });
  if (!product) return { ok: false, error: "Product not found." };
  if (actor.role === "ADMIN") {
    // Admin may load any product — "authorized to manage" per existing
    // admin permission rules, which don't scope products by owner.
  }

  const hasVariants = product.variants.length > 0;
  const sharedData: BulkGroupSharedDataInput = {
    name: product.name,
    slug: product.slug,
    productType: product.productType,
    baseUnit: product.baseUnit,
    hasVariants: hasVariants ? "YES" : "NO",
    audience: product.audience,
    categoryId: product.categoryId,
    subCategoryId: product.subCategoryId ?? "",
    subSubCategoryId: product.subSubCategoryId ?? "",
    brandId: product.brandId ?? "",
    manufacturerId: product.manufacturerId ?? "",
    shortDescription: product.shortDescription,
    description: product.description,
    ingredients: product.ingredients ?? "",
    howToUse: product.howToUse ?? "",
    dosageInstructions: product.dosageInstructions ?? "",
    technicalInfo: product.technicalInfo ?? "",
    searchTags: product.searchTags,
    subtitle: product.subtitle ?? "",
    selectedAttributeIds: [...new Set(product.variantAttributeValues.map((v) => v.attributeId))],
    attributeValues: product.variantAttributeValues.map((v) => ({
      id: v.id,
      attributeId: v.attributeId,
      value: v.value,
      slug: v.slug,
      position: v.position,
      isActive: v.isActive,
    })),
    primaryImageUrl: product.primaryImageUrl,
    images: product.images.map((img) => ({
      id: img.id,
      url: img.url,
      altText: img.altText ?? "",
      position: img.position,
      isActive: img.isActive,
    })),
    videoUrl: product.videoUrl ?? "",
    customerStateIds: product.customerAvailableStates.map((s) => s.id),
    dealerStateIds: product.dealerAvailableStates.map((s) => s.id),
    metaTitle: product.metaTitle ?? "",
    metaDescription: product.metaDescription ?? "",
    metaImageUrl: product.metaImageUrl ?? "",
    canonicalUrl: product.canonicalUrl ?? "",
    editorialBadgeId: product.editorialBadgeId ?? "",
    deliveryBadgeEnabled: product.deliveryBadgeEnabled,
    deliveryBadgeText: product.deliveryBadgeText ?? "",
    availabilityBadgeMode: product.availabilityBadgeMode,
    availabilityBadgeText: product.availabilityBadgeText ?? "",
    featuredPosition: product.featuredPosition ?? undefined,
  };

  const rows: ExistingProductForRecall["rows"] = [];
  if (hasVariants) {
    for (const v of product.variants) {
      rows.push({
        variantId: v.id,
        audience: v.audience,
        rowData: {
          attributeValueRefs: v.values.map((val) => ({
            attributeId: val.attributeValue.attributeId,
            slug: val.attributeValue.slug,
          })),
          skuBase: v.sku,
          hsnCode: v.hsnCode ?? "",
          mrp: v.mrp.toString(),
          sellingPrice: v.sellingPrice.toString(),
          taxPercent: product.taxPercent.toString(),
          minOrderQty: String(v.minOrderQty),
          currentStock: String(v.stockQty),
          minStockQty: String(v.minStockQty),
          reorderLevel: String(v.reorderLevel),
          weight: v.weight != null ? String(v.weight) : "",
          weightUnit: "G",
          height: v.height != null ? String(v.height) : "",
          breadth: v.breadth != null ? String(v.breadth) : "",
          length: v.length != null ? String(v.length) : "",
          dimensionUnit: "M",
          shippingIncluded: v.shippingCalcMode === "EXCLUDE_WITH_PRODUCT" ? "NO" : "YES",
          imageUrl: v.imageUrl ?? "",
          imageAlt: v.imageAlt ?? "",
          isActive: v.isActive,
        },
      });
    }
  } else {
    if (product.customerConfig) {
      const c = product.customerConfig;
      rows.push({
        variantId: null,
        audience: "CUSTOMER",
        rowData: {
          attributeValueRefs: [],
          skuBase: c.sku ?? product.sku,
          hsnCode: c.hsnCode ?? product.hsnCode,
          mrp: c.mrp.toString(),
          sellingPrice: c.sellingPrice.toString(),
          taxPercent: product.taxPercent.toString(),
          minOrderQty: String(c.minOrderQty),
          currentStock: String(c.currentStock),
          minStockQty: String(c.minStockQty),
          reorderLevel: String(c.reorderLevel),
          weight: c.weight != null ? String(c.weight) : "",
          weightUnit: "G",
          height: c.height != null ? String(c.height) : "",
          breadth: c.breadth != null ? String(c.breadth) : "",
          length: c.length != null ? String(c.length) : "",
          dimensionUnit: "M",
          shippingIncluded: c.shippingCalcMode === "EXCLUDE_WITH_PRODUCT" ? "NO" : "YES",
          imageUrl: "",
          imageAlt: "",
          isActive: true,
        },
      });
    }
    if (product.dealerConfig) {
      const c = product.dealerConfig;
      rows.push({
        variantId: null,
        audience: "DEALER",
        rowData: {
          attributeValueRefs: [],
          skuBase: c.sku ?? product.sku,
          hsnCode: c.hsnCode ?? product.hsnCode,
          mrp: c.mrp.toString(),
          sellingPrice: c.sellingPrice.toString(),
          taxPercent: product.taxPercent.toString(),
          minOrderQty: String(c.minOrderQty),
          currentStock: String(c.currentStock),
          minStockQty: String(c.minStockQty),
          reorderLevel: String(c.reorderLevel),
          weight: c.weight != null ? String(c.weight) : "",
          weightUnit: "G",
          height: c.height != null ? String(c.height) : "",
          breadth: c.breadth != null ? String(c.breadth) : "",
          length: c.length != null ? String(c.length) : "",
          dimensionUnit: "M",
          shippingIncluded: "NO",
          imageUrl: "",
          imageAlt: "",
          isActive: true,
        },
      });
    }
  }

  return {
    ok: true,
    product: { id: product.id, name: product.name, hasVariants, sharedData, audience: product.audience },
    rows,
  };
}
