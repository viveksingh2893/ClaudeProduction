import { prisma } from "@kisan4u/db";
import {
  productSubmissionSchema,
  parseBulkGroupSharedData,
  parseBulkRowData,
  slugify,
  type BulkGroupSharedData,
  type BulkRowData,
  type ProductSubmissionRawInput,
} from "@kisan4u/validators";
import { applyProductSubmission } from "./product-submission";
import { assertOwnsProduct } from "./ownership";
import type { BulkActor } from "./bulk-product-draft";

/**
 * Translates one Product Group + its rows into the exact input shape
 * productSubmissionSchema validates and applyProductSubmission persists —
 * the single-product form's own engine, unmodified. This file's only job
 * is the SHAPE conversion; every actual business rule (MRP <= selling
 * price, tax 0-100, SKU suffix correctness, dealer-shipping-locked,
 * licence eligibility, brand/manufacturer ownership, ...) still lives
 * exactly once, in productSubmissionSchema/applyProductSubmission, so the
 * bulk grid can never drift from the single-product form's behavior.
 *
 * MRP/Selling-Price-as-primary-input (spec item: "Prefer MRP and Selling
 * Price as inputs and Discount Percentage as calculated/read-only") is
 * reconciled with the existing MRP+discountType+discountValue model
 * (which computes sellingPrice, never accepts it directly) by deriving a
 * FLAT discount of exactly (mrp - sellingPrice) — calculateSellingPrice's
 * own FLAT-mode arithmetic (mrp - discountValue) round-trips this back to
 * the exact sellingPrice the grid showed, so the same calculation/
 * rounding/validation policy applies to a bulk row as to a single-product
 * form row; "Discount Percentage" itself is purely a UI-side display
 * value, never a field sent to the server.
 */

const PACKAGE_SIZE_PLACEHOLDER: Record<string, string> = {
  PIECE: "1 piece",
  KG: "1 kg",
  G: "1 g",
  L: "1 L",
  ML: "1 ml",
};

function weightToGrams(row: BulkRowData): number | undefined {
  const value = Number(row.weight);
  if (!row.weight || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(row.weightUnit === "KG" ? value * 1000 : value);
}

function dimensionToMetres(raw: string, unit: "CM" | "M"): number | undefined {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) return undefined;
  return unit === "CM" ? value / 100 : value;
}

function discountFromMrpAndSellingPrice(mrp: string, sellingPrice: string) {
  const mrpNum = Number(mrp) || 0;
  const sellingNum = Number(sellingPrice) || 0;
  return { discountType: "FLAT" as const, discountValue: Math.max(0, mrpNum - sellingNum) };
}

type TranslatedRow = { audience: "CUSTOMER" | "DEALER"; data: BulkRowData; existingVariantId: string | null };

/**
 * productSubmissionSchema requires a customerConfig/dealerConfig whenever
 * that audience is needed — with NO exception for a variant product; the
 * single-product form always collects one too (its Pricing/Inventory/
 * Shipping sections render independently of whether the product has
 * variants, per that form's own layout). This base row is never read by
 * anything storefront-facing once real variants exist (product-card-
 * adapter.ts only falls back to it when NO variant resolves) — safe,
 * inert placeholder values, mirroring the first row's weight/HSN/tax so
 * the shipping-cost/HSN it carries is at least plausible rather than
 * meaningless zeros, but never a real second stock pool (currentStock is
 * always 0 here; the variants are the only real inventory).
 */
function placeholderConfigForVariantGroup(rows: TranslatedRow[], groupKey: string, audience: "CUSTOMER" | "DEALER") {
  const sample = rows.find((r) => r.audience === audience);
  return {
    sku: `${groupKey}-base`,
    hsnCode: sample?.data.hsnCode || "000000",
    mrp: 0,
    discountType: "NONE" as const,
    discountValue: 0,
    minOrderQty: 1,
    currentStock: 0,
    minStockQty: 0,
    reorderLevel: 1,
    height: undefined,
    breadth: undefined,
    length: undefined,
    weight: sample ? weightToGrams(sample.data) : undefined,
    shippingCalcMode: (sample?.data.shippingIncluded === "NO"
      ? "EXCLUDE_WITH_PRODUCT"
      : "INCLUDE_WITH_PRODUCT") as "INCLUDE_WITH_PRODUCT" | "EXCLUDE_WITH_PRODUCT",
  };
}

function toConfigInput(row: TranslatedRow, isDigital: boolean) {
  const { discountType, discountValue } = discountFromMrpAndSellingPrice(row.data.mrp, row.data.sellingPrice);
  return {
    sku: row.data.skuBase,
    hsnCode: row.data.hsnCode,
    mrp: Number(row.data.mrp) || 0,
    discountType,
    discountValue,
    minOrderQty: Number(row.data.minOrderQty) || 1,
    currentStock: Number(row.data.currentStock) || 0,
    minStockQty: Number(row.data.minStockQty) || 0,
    reorderLevel: Number(row.data.reorderLevel) || 0,
    height: isDigital ? undefined : dimensionToMetres(row.data.height, row.data.dimensionUnit),
    breadth: isDigital ? undefined : dimensionToMetres(row.data.breadth, row.data.dimensionUnit),
    length: isDigital ? undefined : dimensionToMetres(row.data.length, row.data.dimensionUnit),
    weight: isDigital ? undefined : weightToGrams(row.data),
    shippingCalcMode:
      row.data.shippingIncluded === "NO"
        ? ("EXCLUDE_WITH_PRODUCT" as const)
        : ("INCLUDE_WITH_PRODUCT" as const),
  };
}

function toVariantInput(row: TranslatedRow, isDigital: boolean) {
  const { discountType, discountValue } = discountFromMrpAndSellingPrice(row.data.mrp, row.data.sellingPrice);
  return {
    id: row.existingVariantId ?? undefined,
    attributeValueRefs: row.data.attributeValueRefs,
    sku: row.data.skuBase,
    hsnCode: row.data.hsnCode,
    mrp: Number(row.data.mrp) || 0,
    discountType,
    discountValue,
    minOrderQty: Number(row.data.minOrderQty) || 1,
    stockQty: Number(row.data.currentStock) || 0,
    minStockQty: Number(row.data.minStockQty) || 0,
    reorderLevel: Number(row.data.reorderLevel) || 0,
    height: isDigital ? undefined : dimensionToMetres(row.data.height, row.data.dimensionUnit),
    breadth: isDigital ? undefined : dimensionToMetres(row.data.breadth, row.data.dimensionUnit),
    length: isDigital ? undefined : dimensionToMetres(row.data.length, row.data.dimensionUnit),
    weight: isDigital ? undefined : weightToGrams(row.data),
    shippingCalcMode:
      row.data.shippingIncluded === "NO"
        ? ("EXCLUDE_WITH_PRODUCT" as const)
        : ("INCLUDE_WITH_PRODUCT" as const),
    imageUrl: row.data.imageUrl || undefined,
    imageAlt: row.data.imageAlt || undefined,
    isActive: row.data.isActive,
  };
}

export function translateGroupToSubmissionInput(
  groupKey: string,
  shared: BulkGroupSharedData,
  rows: TranslatedRow[],
  pendingId?: string,
): ProductSubmissionRawInput {
  const audience = shared.audience ?? "CUSTOMER_ONLY";
  const needsCustomer = audience === "CUSTOMER_ONLY" || audience === "BOTH_CUSTOMER_AND_DEALER";
  const needsDealer = audience === "DEALER_ONLY" || audience === "BOTH_CUSTOMER_AND_DEALER";
  const isDigital = shared.productType === "DIGITAL";
  const isVariantProduct = shared.hasVariants === "YES";

  const customerRows = rows.filter((r) => r.audience === "CUSTOMER");
  const dealerRows = rows.filter((r) => r.audience === "DEALER");

  const firstRowHsn = rows[0]?.data.hsnCode || "000000";
  // Single product-level tax rate — same "first row wins" convention as
  // firstRowHsn above, now that tax is no longer per-audience-config (see
  // Product.taxPercent's schema comment). The "Fill tax % down" button in
  // the grid is what keeps every row consistent in practice.
  const firstRowTaxPercent = Number(rows[0]?.data.taxPercent) || 0;
  const baseUnit = shared.baseUnit ?? "PIECE";

  return {
    id: pendingId,
    name: shared.name,
    slug: shared.slug || slugify(shared.name),
    // Vestigial parent-level identity (spec never exposes this in the
    // bulk UI — SKU is entirely row-level now, see item #4/#5's earlier
    // redesign this same codebase already went through) — derived from
    // the Product Group ID itself, which the sheet already keeps unique.
    sku: shared.name ? slugify(shared.name).toUpperCase() || "PRODUCT" : "PRODUCT",
    hsnCode: firstRowHsn,
    taxPercent: firstRowTaxPercent,
    shortDescription: shared.shortDescription,
    description: shared.description,
    ingredients: shared.ingredients || undefined,
    howToUse: shared.howToUse || undefined,
    dosageInstructions: shared.dosageInstructions || undefined,
    technicalInfo: shared.technicalInfo || undefined,
    productType: shared.productType,
    baseUnit,
    packageSize: PACKAGE_SIZE_PLACEHOLDER[baseUnit] ?? "1 unit",
    searchTags: shared.searchTags,
    featuredPosition: shared.featuredPosition,
    categoryId: shared.categoryId,
    subCategoryId: shared.subCategoryId || undefined,
    subSubCategoryId: shared.subSubCategoryId || undefined,
    brandId: shared.brandId || undefined,
    manufacturerId: shared.manufacturerId || undefined,
    audience,
    customerVisible: needsCustomer,
    dealerVisible: needsDealer,
    customerConfig: needsCustomer
      ? !isVariantProduct && customerRows[0]
        ? toConfigInput(customerRows[0], isDigital)
        : isVariantProduct
          ? placeholderConfigForVariantGroup(rows, groupKey, "CUSTOMER")
          : undefined
      : undefined,
    dealerConfig: needsDealer
      ? !isVariantProduct && dealerRows[0]
        ? toConfigInput(dealerRows[0], isDigital)
        : isVariantProduct
          ? placeholderConfigForVariantGroup(rows, groupKey, "DEALER")
          : undefined
      : undefined,
    attributeValues: isVariantProduct ? shared.attributeValues : [],
    customerVariants:
      needsCustomer && isVariantProduct ? customerRows.map((r) => toVariantInput(r, isDigital)) : [],
    dealerVariants:
      needsDealer && isVariantProduct ? dealerRows.map((r) => toVariantInput(r, isDigital)) : [],
    customerStateIds: shared.customerStateIds,
    dealerStateIds: shared.dealerStateIds,
    primaryImageUrl: shared.primaryImageUrl,
    videoUrl: shared.videoUrl || undefined,
    images: shared.images,
    metaTitle: shared.metaTitle || undefined,
    metaDescription: shared.metaDescription || undefined,
    metaImageUrl: shared.metaImageUrl || undefined,
    canonicalUrl: shared.canonicalUrl || undefined,
    subtitle: shared.subtitle || undefined,
    editorialBadgeId: shared.editorialBadgeId || undefined,
    deliveryBadgeEnabled: shared.deliveryBadgeEnabled,
    deliveryBadgeText: shared.deliveryBadgeText || undefined,
    availabilityBadgeMode: shared.availabilityBadgeMode,
    availabilityBadgeText: shared.availabilityBadgeText || undefined,
  };
}

export type BulkGroupSubmissionResult = {
  groupKey: string;
  ok: boolean;
  productId?: string;
  productHref?: string;
  error?: string;
  fieldErrors?: string[];
};

/**
 * Processes every group in a draft, each independently and atomically
 * (applyProductSubmission already wraps one group's own writes in a
 * single transaction) — a failure in one group never blocks or half-
 * completes another (spec: "Never leave one product group half-created").
 *
 * Idempotent retries: the moment a group succeeds (CREATE or UPDATE), its
 * BulkProductGroup.existingProductId is set to the resulting productId in
 * the same step — so re-running submission (the user clicking Submit
 * again after fixing OTHER failed groups) turns an already-succeeded
 * group's next attempt into a harmless UPDATE of the same product rather
 * than a duplicate CREATE, without needing a separate "already submitted"
 * flag.
 */
export type BulkGroupValidationResult = {
  groupKey: string;
  ok: boolean;
  fieldErrors?: string[];
  isVariantProduct: boolean;
  audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";
  customerRowCount: number;
  dealerRowCount: number;
  isNewProduct: boolean;
};

/**
 * "Validate All" / Submission Preview — the exact same translate +
 * productSubmissionSchema.safeParse step submitBulkDraft runs per group,
 * but with no applyProductSubmission call and no database write at all.
 * Spec: "Revalidate everything on the server... Never trust client-
 * calculated values" — this is what lets the grid show real server-side
 * validation errors before the seller/admin commits to submitting.
 */
export async function validateBulkDraft(
  actor: BulkActor,
  draftId: string,
): Promise<{ ok: true; results: BulkGroupValidationResult[] } | { ok: false; error: string }> {
  const draft = await prisma.bulkProductDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { ok: false, error: "Draft not found." };
  if (actor.role === "SELLER" && draft.sellerId !== actor.sellerId)
    return { ok: false, error: "Draft not found." };
  if (actor.role === "ADMIN" && draft.createdByUserId !== actor.userId)
    return { ok: false, error: "Draft not found." };

  const groups = await prisma.bulkProductGroup.findMany({
    where: { draftId },
    orderBy: { position: "asc" },
    include: { rows: { orderBy: { position: "asc" } } },
  });

  const results: BulkGroupValidationResult[] = groups.map((group) => {
    const shared = parseBulkGroupSharedData(group.sharedData);
    const rows: TranslatedRow[] = group.rows.map((r) => ({
      audience: r.audience,
      data: parseBulkRowData(r.rowData),
      existingVariantId: r.existingVariantId,
    }));
    const rawInput = translateGroupToSubmissionInput(group.groupKey, shared, rows);
    const parsed = productSubmissionSchema.safeParse(rawInput);
    const isNewProduct = !group.existingProductId;
    const missingSeller = isNewProduct && actor.role === "ADMIN" && !group.sellerId;
    const fieldErrors = parsed.success
      ? undefined
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return {
      groupKey: group.groupKey,
      ok: parsed.success && !missingSeller,
      fieldErrors: missingSeller ? [...(fieldErrors ?? []), "seller: This group has no seller assigned."] : fieldErrors,
      isVariantProduct: shared.hasVariants === "YES",
      audience: shared.audience ?? "CUSTOMER_ONLY",
      customerRowCount: rows.filter((r) => r.audience === "CUSTOMER").length,
      dealerRowCount: rows.filter((r) => r.audience === "DEALER").length,
      isNewProduct,
    };
  });

  return { ok: true, results };
}

export async function submitBulkDraft(
  actor: BulkActor,
  draftId: string,
): Promise<{ ok: true; results: BulkGroupSubmissionResult[] } | { ok: false; error: string }> {
  const draft = await prisma.bulkProductDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { ok: false, error: "Draft not found." };
  if (actor.role === "SELLER" && draft.sellerId !== actor.sellerId)
    return { ok: false, error: "Draft not found." };
  if (actor.role === "ADMIN" && draft.createdByUserId !== actor.userId)
    return { ok: false, error: "Draft not found." };

  const groups = await prisma.bulkProductGroup.findMany({
    where: { draftId },
    orderBy: { position: "asc" },
    include: { rows: { orderBy: { position: "asc" } } },
  });

  const results: BulkGroupSubmissionResult[] = [];

  for (const group of groups) {
    const shared = parseBulkGroupSharedData(group.sharedData);
    const rows: TranslatedRow[] = group.rows.map((r) => ({
      audience: r.audience,
      data: parseBulkRowData(r.rowData),
      existingVariantId: r.existingVariantId,
    }));

    const rawInput = translateGroupToSubmissionInput(group.groupKey, shared, rows);
    const parsed = productSubmissionSchema.safeParse(rawInput);
    if (!parsed.success) {
      results.push({
        groupKey: group.groupKey,
        ok: false,
        error: "This group has validation errors.",
        fieldErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      continue;
    }

    let submission: Awaited<ReturnType<typeof applyProductSubmission>>;
    if (group.existingProductId) {
      // applyProductSubmission's UPDATE path re-derives sellerId FROM the
      // product row itself — it does not check that THIS caller is
      // authorized to edit it (that's always the calling server action's
      // job, same as apps/dashboard/src/app/seller/products/actions.ts's
      // updateProductAction). existingProductId is informational-only
      // (see BulkProductGroup's schema doc comment) precisely because a
      // draft can outlive changes elsewhere, so it's re-verified here on
      // every submit, never trusted from what was stored when the group
      // was created.
      if (actor.role === "SELLER") {
        const owns = await assertOwnsProduct(actor.sellerId, group.existingProductId);
        if (!owns.ok) {
          results.push({ groupKey: group.groupKey, ok: false, error: owns.error });
          continue;
        }
      }
      submission = await applyProductSubmission(parsed.data, {
        mode: "UPDATE",
        productId: group.existingProductId,
        asAdmin: actor.role === "ADMIN",
      });
    } else {
      // A brand-new product needs a real owning seller before it can be
      // created. A seller's own draft always creates under themselves; an
      // admin draft has no single owning seller (BulkProductDraft.sellerId
      // is null for admin drafts) — each group carries its own sellerId
      // instead (see upsertBulkGroup), so a single admin sheet can create
      // products for several different sellers in one submission. A group
      // left unassigned fails on its own, without blocking any other
      // group in the same draft.
      const groupSellerId = actor.role === "SELLER" ? actor.sellerId : group.sellerId;
      if (!groupSellerId) {
        results.push({ groupKey: group.groupKey, ok: false, error: "This group has no seller assigned." });
        continue;
      }
      submission = await applyProductSubmission(parsed.data, {
        mode: "CREATE",
        sellerId: groupSellerId,
        asAdmin: false,
      });
    }

    if (!submission.ok) {
      results.push({ groupKey: group.groupKey, ok: false, error: submission.error });
      continue;
    }

    if (!group.existingProductId) {
      await prisma.bulkProductGroup.update({
        where: { id: group.id },
        data: { existingProductId: submission.productId },
      });
    }
    results.push({
      groupKey: group.groupKey,
      ok: true,
      productId: submission.productId,
      productHref:
        actor.role === "ADMIN" ? `/admin/products/${submission.productId}` : `/seller/products/${submission.productId}`,
    });
  }

  const anyFailed = results.some((r) => !r.ok);
  await prisma.bulkProductDraft.update({
    where: { id: draftId },
    data: { status: anyFailed ? "OPEN" : "COMPLETED" },
  });

  return { ok: true, results };
}
