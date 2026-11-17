import { prisma } from "@kisan4u/db";
import {
  type ProductDraftSubmissionInput,
  type ProductSubmissionInput,
  slugify,
} from "@kisan4u/validators";
import { applyProductSubmission, type ApplyProductSubmissionResult, type SubmissionContext } from "./product-submission";

type DraftConfig = NonNullable<ProductDraftSubmissionInput["customerConfig"]>;
type DraftVariant = ProductDraftSubmissionInput["customerVariants"][number];
type FullConfig = ProductSubmissionInput["customerConfig"];
type FullVariant = ProductSubmissionInput["customerVariants"][number];

/** Never collides with a slug a real product might actually want — a Category's own slug namespace is unrelated to Product's, so this could in principle be reused by a real category, but it's marked inactive and never offered in any category picker. */
const DRAFT_PLACEHOLDER_CATEGORY_SLUG = "draft-placeholder-uncategorized";

/**
 * A brand-new draft with no category chosen yet still needs *some* real
 * categoryId (Product.categoryId is a required FK — see spec discussion in
 * product-draft.test.ts). Rather than loosening that FK to nullable (which
 * would force every other reader of Product.category across the codebase to
 * add a null-check for a case that, in practice, can only ever exist on an
 * unfinished draft), a real-but-hidden Category row is used as the
 * placeholder — `isActive: false` keeps it out of every category picker and
 * public listing, and assertProductComplete (product-decisions.ts) refuses
 * to let a product still pointing at it reach SUBMITTED.
 */
async function getDraftPlaceholderCategoryId(): Promise<string> {
  const existing = await prisma.category.findUnique({
    where: { slug: DRAFT_PLACEHOLDER_CATEGORY_SLUG },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.category.create({
    data: {
      name: "Uncategorized (draft placeholder — not a real category)",
      slug: DRAFT_PLACEHOLDER_CATEGORY_SLUG,
      isActive: false,
    },
    select: { id: true },
  });
  return created.id;
}

export { DRAFT_PLACEHOLDER_CATEGORY_SLUG, getDraftPlaceholderCategoryId };

async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || `product-${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 1;
  // A brand-new draft's name is very unlikely to collide, but a seller
  // typing the same placeholder name ("New product") repeatedly is a real
  // scenario worth handling cleanly rather than surfacing a raw DB error.
  while (
    await prisma.product.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
  ) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

/** Checked against every table that shares the sellable-unit SKU namespace (see applyProductSubmission's own equivalent check) — a placeholder is regenerated on the rare collision rather than ever failing the draft save outright. */
async function generateUniquePlaceholderSku(prefix: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    const [product, variant, customerConfig, dealerConfig] = await Promise.all([
      prisma.product.findFirst({ where: { sku: candidate }, select: { id: true } }),
      prisma.productVariant.findFirst({ where: { sku: candidate }, select: { id: true } }),
      prisma.productCustomerConfig.findFirst({ where: { sku: candidate }, select: { productId: true } }),
      prisma.productDealerConfig.findFirst({ where: { sku: candidate }, select: { productId: true } }),
    ]);
    if (!product && !variant && !customerConfig && !dealerConfig) return candidate;
  }
  throw new Error("Could not generate a unique placeholder SKU — please try saving again.");
}

function fillConfigDefaults(config: DraftConfig, skuPlaceholder: string): FullConfig {
  return {
    sku: config.sku?.trim() || skuPlaceholder,
    hsnCode: config.hsnCode ?? "",
    mrp: config.mrp ?? 0,
    discountType: config.discountType ?? "NONE",
    discountValue: config.discountValue ?? 0,
    netPayableAmount: config.netPayableAmount,
    minOrderQty: config.minOrderQty ?? 1,
    currentStock: config.currentStock ?? 0,
    minStockQty: config.minStockQty ?? 5,
    reorderLevel: config.reorderLevel ?? 10,
    height: config.height,
    breadth: config.breadth,
    length: config.length,
    weight: config.weight,
    shippingCalcMode: config.shippingCalcMode ?? "INCLUDE_WITH_PRODUCT",
    taxCalcMode: config.taxCalcMode ?? "INCLUDE_WITH_PRICE",
  };
}

function fillVariantDefaults(variant: DraftVariant, skuPlaceholder: string): FullVariant {
  return {
    ...variant,
    attributeValueRefs: variant.attributeValueRefs ?? [],
    sku: variant.sku?.trim() || skuPlaceholder,
    hsnCode: variant.hsnCode ?? "",
    mrp: variant.mrp ?? 0,
    discountType: variant.discountType ?? "NONE",
    discountValue: variant.discountValue ?? 0,
    minOrderQty: variant.minOrderQty ?? 1,
    stockQty: variant.stockQty ?? 0,
    minStockQty: variant.minStockQty ?? 5,
    reorderLevel: variant.reorderLevel ?? 10,
    shippingCalcMode: variant.shippingCalcMode ?? "INCLUDE_WITH_PRODUCT",
    images: variant.images ?? [],
    isActive: variant.isActive ?? true,
  };
}

/**
 * Turns a lenient `productDraftSubmissionSchema`-parsed object (only `name`
 * guaranteed) into a fully-valid `ProductSubmissionInput`, so the existing,
 * unmodified `applyProductSubmission` transaction can be reused as-is —
 * every field a real submission needs gets a safe, inert placeholder
 * instead of the caller having to supply it. `existingProductId` is passed
 * on UPDATE so slug/sku uniqueness checks correctly exclude the row being
 * saved.
 */
export async function fillDraftDefaults(
  draft: ProductDraftSubmissionInput,
  existingProductId?: string,
): Promise<ProductSubmissionInput> {
  const [slug, sku, categoryId] = await Promise.all([
    draft.slug?.trim() ? draft.slug : generateUniqueSlug(draft.name, existingProductId),
    draft.sku?.trim() ? draft.sku : generateUniquePlaceholderSku("DRAFT"),
    draft.categoryId?.trim() ? draft.categoryId : getDraftPlaceholderCategoryId(),
  ]);

  const [customerConfig, dealerConfig] = await Promise.all([
    draft.customerConfig
      ? fillConfigDefaults(draft.customerConfig, await generateUniquePlaceholderSku("DRAFT-CFG"))
      : undefined,
    draft.dealerConfig
      ? fillConfigDefaults(draft.dealerConfig, await generateUniquePlaceholderSku("DRAFT-CFG"))
      : undefined,
  ]);
  const customerVariants = await Promise.all(
    draft.customerVariants.map(async (v) =>
      fillVariantDefaults(v, v.sku?.trim() ? v.sku : await generateUniquePlaceholderSku("DRAFT-VAR")),
    ),
  );
  const dealerVariants = await Promise.all(
    draft.dealerVariants.map(async (v) =>
      fillVariantDefaults(v, v.sku?.trim() ? v.sku : await generateUniquePlaceholderSku("DRAFT-VAR")),
    ),
  );

  return {
    ...draft,
    slug,
    sku,
    hsnCode: draft.hsnCode ?? "",
    taxPercent: draft.taxPercent ?? 0,
    shortDescription: draft.shortDescription ?? "",
    description: draft.description ?? "",
    productType: draft.productType ?? "PHYSICAL",
    baseUnit: draft.baseUnit ?? "PIECE",
    packageSize: draft.packageSize ?? "",
    categoryId,
    audience: draft.audience ?? "CUSTOMER_ONLY",
    customerVisible: draft.customerVisible ?? true,
    dealerVisible: draft.dealerVisible ?? true,
    customerConfig,
    dealerConfig,
    attributeValues: draft.attributeValues,
    customerVariants,
    dealerVariants,
    primaryImageUrl: draft.primaryImageUrl ?? "",
    images: draft.images,
    availabilityBadgeMode: draft.availabilityBadgeMode ?? "AUTOMATIC",
    deliveryBadgeEnabled: draft.deliveryBadgeEnabled ?? false,
  };
}

/** Save-at-any-point entry point — see fillDraftDefaults' doc comment. Reuses applyProductSubmission unchanged, so every other rule it enforces (ownership, brand/manufacturer approval, licence-eligibility clamping, SKU-namespace uniqueness) still applies exactly as it does for a full submission. */
export async function saveProductDraft(
  draft: ProductDraftSubmissionInput,
  context: SubmissionContext,
): Promise<ApplyProductSubmissionResult> {
  const existingProductId = context.mode === "UPDATE" ? context.productId : undefined;
  const filled = await fillDraftDefaults(draft, existingProductId);
  return applyProductSubmission(filled, context);
}
