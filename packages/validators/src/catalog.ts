import { z } from "zod";
import {
  slugSchema,
  mediaUrlSchema,
  videoUrlSchema,
  moneySchema,
  positiveIntSchema,
  nonNegativeIntSchema,
  weightGramsSchema,
  activeToggleSchema,
} from "./primitives";
import { discountTypeEnum, validateDiscountInput, type DiscountTypeInput } from "./pricing";
import { combinationKeyFromRefs } from "./variant-combinations";
import { richTextVisibleLength } from "./rich-text";
import { dbLanguageEnum } from "./language";

export {
  slugSchema,
  mediaUrlSchema,
  videoUrlSchema,
  moneySchema,
  positiveIntSchema,
  nonNegativeIntSchema,
  weightGramsSchema,
  activeToggleSchema,
};
export type { ActiveToggleInput, VideoEmbedKind } from "./primitives";
export { classifyVideoUrl, slugify } from "./primitives";

// ---------------------------------------------------------------------------
// Category hierarchy
// ---------------------------------------------------------------------------

/**
 * Per-language name overrides for a category-hierarchy node — mirrors
 * productTranslationsSectionSchema. `nameTranslations` is optional
 * (undefined = "leave existing rows untouched"); each entry's blank/omitted
 * `name` deletes that language's row. English is never a valid entry here.
 */
export const categoryNameTranslationInputSchema = z.object({
  language: dbLanguageEnum.refine(
    (l) => l !== "EN",
    "English is the source language, not a translation",
  ),
  name: z.string().trim().max(300).optional().or(z.literal("")),
});
export type CategoryNameTranslationInput = z.infer<typeof categoryNameTranslationInputSchema>;

export const categoryNameTranslationsSectionSchema = z.object({
  nameTranslations: z.array(categoryNameTranslationInputSchema).max(4).optional(),
});

// Shown below the "Shop in {name}" heading on the category / sub-category
// / sub-sub-category storefront page — optional, plain text (no markup).
const categoryDescriptionSchema = z.string().trim().max(1000).optional().or(z.literal(""));

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a category name"),
  slug: slugSchema,
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
  // A single emoji for the storefront category ribbon / category pages.
  // Lenient here (up to 8 chars covers multi-codepoint emoji); the admin
  // category form enforces that it is filled.
  emoji: z.string().trim().max(8).optional().or(z.literal("")),
  description: categoryDescriptionSchema,
  position: z.coerce.number().int().default(0),
  ...categoryNameTranslationsSectionSchema.shape,
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const subcategoryInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a subcategory name"),
  slug: slugSchema,
  categoryId: z.string().min(1, "Select a category"),
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
  description: categoryDescriptionSchema,
  position: z.coerce.number().int().default(0),
  ...categoryNameTranslationsSectionSchema.shape,
});
export type SubcategoryInput = z.infer<typeof subcategoryInputSchema>;

export const subSubCategoryInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a sub-subcategory name"),
  slug: slugSchema,
  subCategoryId: z.string().min(1, "Select a subcategory"),
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
  description: categoryDescriptionSchema,
  position: z.coerce.number().int().default(0),
  ...categoryNameTranslationsSectionSchema.shape,
});
export type SubSubCategoryInput = z.infer<typeof subSubCategoryInputSchema>;

// ---------------------------------------------------------------------------
// Crop / Pest & Disease — flat admin-curated merchandising masters
// (Homepage redesign, phase B #5/#6). name + required emoji placeholder +
// optional image. Same lenient emoji rule as categoryInputSchema; the
// admin form (MasterDataManager hasEmoji) enforces that it's filled.
// ---------------------------------------------------------------------------

export const cropInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a crop name"),
  slug: slugSchema,
  emoji: z.string().trim().max(8).optional().or(z.literal("")),
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
});
export type CropInput = z.infer<typeof cropInputSchema>;

export const pestDiseaseInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a pest or disease name"),
  slug: slugSchema,
  emoji: z.string().trim().max(8).optional().or(z.literal("")),
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
});
export type PestDiseaseInput = z.infer<typeof pestDiseaseInputSchema>;

// ---------------------------------------------------------------------------
// Brand / Manufacturer — seller-submittable (PENDING) or admin-created
// (APPROVED immediately, ownerSellerId null = global). See
// packages/db/prisma/schema.prisma Brand/Manufacturer doc comments.
// ---------------------------------------------------------------------------

export const namedMasterDataSchema = z.object({
  name: z.string().trim().min(2, "Enter a name"),
  slug: slugSchema,
});
export type NamedMasterDataInput = z.infer<typeof namedMasterDataSchema>;

export const brandInputSchema = namedMasterDataSchema.extend({
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
});
export type BrandInput = z.infer<typeof brandInputSchema>;

export const manufacturerInputSchema = brandInputSchema;
export type ManufacturerInput = BrandInput;

/** Admin decision on a seller-submitted (or existing) brand/manufacturer. */
export const brandManufacturerDecisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT", "SUSPEND", "REACTIVATE", "DEACTIVATE"]),
  reason: z.string().trim().max(500).optional(),
});
export type BrandManufacturerDecisionInput = z.infer<typeof brandManufacturerDecisionSchema>;

// ---------------------------------------------------------------------------
// Attributes — the master defines only the NAME (Size, Color, Fabric, ...).
// Values are product-specific — see productAttributeValueInputSchema below,
// submitted as part of the product form, not a separate global master.
// ---------------------------------------------------------------------------

export const attributeInputSchema = namedMasterDataSchema;
export type AttributeInput = z.infer<typeof attributeInputSchema>;

export const productAttributeValueInputSchema = z.object({
  // Present = update this exact existing row (rename/reorder/activate-safe);
  // absent = create a new one. Real ids only exist once a product has been
  // saved at least once — see the product-form's load-existing-value flow.
  id: z.string().optional(),
  attributeId: z.string().min(1, "Select an attribute"),
  value: z.string().trim().min(1, "Enter a value"),
  slug: slugSchema,
  position: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type ProductAttributeValueInput = z.infer<typeof productAttributeValueInputSchema>;

// ---------------------------------------------------------------------------
// Product form — one Zod object per section, plus a combined submission
// schema with cross-field checks.
// ---------------------------------------------------------------------------

export const productAudienceEnum = z.enum(["CUSTOMER_ONLY", "DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"]);
export const baseUnitEnum = z.enum(["G", "KG", "ML", "L", "PIECE"]);
export const productTypeEnum = z.enum(["PHYSICAL", "DIGITAL"]);
export const shippingCalcModeEnum = z.enum(["INCLUDE_WITH_PRODUCT", "EXCLUDE_WITH_PRODUCT"]);
// See the Prisma TaxCalcMode enum's doc comment — whether taxPercent is
// already baked into the selling price the seller typed, or should be
// added on top. Defaults to inclusive for every row, per spec.
export const taxCalcModeEnum = z.enum(["INCLUDE_WITH_PRICE", "EXCLUDE_WITH_PRICE"]);
export const priceEntryModeEnum = z.enum(["SELLING_PRICE", "NET_PAYABLE"]);
export const variantAudienceEnum = z.enum(["CUSTOMER", "DEALER"]);
export { discountTypeEnum };

// ---------------------------------------------------------------------------
// Audience-specific SKU suffix convention (spec item #4). Every sellable
// unit — a simple product's per-audience base config, or a variant row —
// carries its own SKU ending in "-cus" (customer) or "-dea" (dealer).
// Applies going forward only: existing rows saved before this feature keep
// whatever SKU they already had (see the migration's doc comment) until
// the product is next saved through this schema.
// ---------------------------------------------------------------------------

export const AUDIENCE_SKU_SUFFIX = { CUSTOMER: "-cus", DEALER: "-dea" } as const;
export type AudienceSkuAudience = keyof typeof AUDIENCE_SKU_SUFFIX;

export type NormalizeAudienceSkuResult = { ok: true; sku: string } | { ok: false; error: string };

/**
 * A SKU with no recognized suffix gets the correct one appended
 * automatically (idempotent — an already-correctly-suffixed SKU is
 * returned unchanged, so re-saving a form never double-appends). A SKU
 * that already carries the OTHER audience's suffix is rejected rather
 * than silently rewritten: that pattern is far more likely to be a
 * copy-paste mistake (pasting the dealer SKU into the customer field)
 * than genuine intent, and silently swapping it would hide the mistake
 * instead of surfacing it.
 */
export function normalizeAudienceSku(
  rawSku: string,
  audience: AudienceSkuAudience,
): NormalizeAudienceSkuResult {
  const trimmed = rawSku.trim();
  if (!trimmed) return { ok: false, error: "Enter a SKU." };

  const ownSuffix = AUDIENCE_SKU_SUFFIX[audience];
  const otherAudience: AudienceSkuAudience = audience === "CUSTOMER" ? "DEALER" : "CUSTOMER";
  const otherSuffix = AUDIENCE_SKU_SUFFIX[otherAudience];
  const lower = trimmed.toLowerCase();

  if (lower.endsWith(otherSuffix)) {
    return {
      ok: false,
      error: `This SKU ends in "${otherSuffix}" (the ${otherAudience.toLowerCase()} suffix) — it can't be used as a ${audience.toLowerCase()} SKU. Use a SKU ending in "${ownSuffix}" instead.`,
    };
  }
  if (lower.endsWith(ownSuffix)) {
    // Preserve the base exactly as typed; only the suffix itself is case-normalized.
    const base = trimmed.slice(0, trimmed.length - ownSuffix.length);
    return { ok: true, sku: `${base}${ownSuffix}` };
  }
  return { ok: true, sku: `${trimmed}${ownSuffix}` };
}

export const productGeneralSchema = z.object({
  name: z.string().trim().min(2, "Enter a product name"),
  slug: slugSchema,
  sku: z.string().trim().min(1, "Enter or generate a SKU"),
  hsnCode: z.string().trim().min(1, "Enter an HSN code"),
  // Single tax rate for the whole product — shared by every audience and
  // variant (see Product.taxPercent's schema comment). Deliberately here,
  // not in productConfigSchema below — there is no more per-audience
  // divergence to represent.
  taxPercent: moneySchema.default(0),
  // How the seller entered pricing (see the Prisma PriceEntryMode enum).
  // SELLING_PRICE (default) = every config/variant carries a real
  // mrp+discount the way it always has. NET_PAYABLE = the seller typed a
  // target post-settlement net payable per unit instead; the server action
  // back-solves the selling price from each unit's netPayableAmount (see
  // @kisan4u/validators net-payable.ts) BEFORE applyProductSubmission, so
  // by the time a row is written it is an ordinary mrp+discount row again.
  priceEntryMode: priceEntryModeEnum.default("SELLING_PRICE"),
  // Rich-text HTML (spec item #1) — validated against the VISIBLE text
  // length, not the raw markup length, so an editor-produced string like
  // "<p><br></p>" (empty-looking, 11 raw characters) never satisfies a
  // naive .min() check the way it would on a plain textarea.
  shortDescription: z
    .string()
    .trim()
    .refine((html) => richTextVisibleLength(html) >= 10, "Enter a short description"),
  description: z
    .string()
    .trim()
    .refine((html) => richTextVisibleLength(html) >= 20, "Enter a full description"),
  ingredients: z.string().trim().optional().or(z.literal("")),
  howToUse: z.string().trim().optional().or(z.literal("")),
  dosageInstructions: z.string().trim().optional().or(z.literal("")),
  technicalInfo: z.string().trim().optional().or(z.literal("")),
  productType: productTypeEnum.default("PHYSICAL"),
  baseUnit: baseUnitEnum,
  // No base-level .min(1) — a variant product has no single package size
  // (each variant is its own sellable unit), so this is only required
  // when the product turns out to have no variants; see
  // productSubmissionSchema's superRefine below, where customerVariants/
  // dealerVariants are actually known.
  packageSize: z.string().trim().optional().or(z.literal("")),
  searchTags: z.array(z.string().trim().min(1)).default([]),
  featuredPosition: z.coerce.number().int().optional(),
});

/**
 * One non-English translation of a product's rich-text description fields
 * (storefront i18n). Every field is optional — a partly-translated product
 * is fine, each missing field falls back to the English value on the
 * Product row at read time (see @kisan4u/catalog product-content.ts). The
 * HTML is sanitized server-side through the same allowlist as the English
 * fields (applyProductSubmission). `EN` is rejected here — English is never
 * stored as a translation row.
 */
export const productTranslationInputSchema = z.object({
  language: dbLanguageEnum.refine((l) => l !== "EN", "English is the source language, not a translation"),
  // Plain text (not rich text). Optional like every translated field —
  // blank ⇒ the storefront shows the English name for this language.
  name: z.string().trim().max(300).optional().or(z.literal("")),
  shortDescription: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().optional().or(z.literal("")),
  ingredients: z.string().trim().optional().or(z.literal("")),
  howToUse: z.string().trim().optional().or(z.literal("")),
  dosageInstructions: z.string().trim().optional().or(z.literal("")),
  technicalInfo: z.string().trim().optional().or(z.literal("")),
});
export type ProductTranslationInput = z.infer<typeof productTranslationInputSchema>;

export const productTranslationsSectionSchema = z.object({
  // Optional, not `.default([])`: a submission that doesn't carry the field
  // (bulk upload, admin approve) must leave any existing ProductTranslation
  // rows untouched, so applyProductSubmission treats `undefined` as "no
  // change" and `[]`/entries as the authoritative set. The product form
  // always sends all four non-English languages.
  translations: z.array(productTranslationInputSchema).max(4).optional(),
});

export const productCategorySelectionSchema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  subCategoryId: z.string().min(1).optional().or(z.literal("")),
  subSubCategoryId: z.string().min(1).optional().or(z.literal("")),
  // Homepage redesign, phase B — merchandising/discovery tags. Unknown ids
  // are silently dropped server-side (see applyProductSubmission), so an
  // empty or stale selection is never a hard save failure.
  cropIds: z.array(z.string().min(1)).default([]),
  pestDiseaseIds: z.array(z.string().min(1)).default([]),
});

export const productBrandSelectionSchema = z.object({
  brandId: z.string().min(1).optional().or(z.literal("")),
  manufacturerId: z.string().min(1).optional().or(z.literal("")),
});

export const productAudienceSectionSchema = z.object({
  audience: productAudienceEnum,
  customerVisible: z.boolean().default(true),
  dealerVisible: z.boolean().default(true),
});

/**
 * Customer/dealer base configuration — mrp+discount only, never a raw
 * selling price (see packages/validators/src/pricing.ts). Also never a
 * shippingCost input: shipping is always server-computed from `weight`
 * against the active logistics-pricing config (see
 * packages/catalog/src/logistics-pricing.ts) — the form only ever shows
 * it back as a read-only, freshly-recalculated value, never accepts one.
 * Dimensions (height/breadth/length) are metres; weight is whole grams.
 */
const productConfigSchema = z.object({
  // Sellable-unit SKU/HSN for a simple (no-variant) product's audience
  // config — see normalizeAudienceSku above for the "-cus"/"-dea" suffix
  // rule. Suffix correctness is checked in productSubmissionSchema's
  // superRefine below, where the audience (customerConfig vs
  // dealerConfig) is known.
  sku: z.string().trim().min(1, "Enter a SKU"),
  hsnCode: z.string().trim().min(1, "Enter an HSN code"),
  mrp: moneySchema,
  discountType: discountTypeEnum.default("NONE"),
  discountValue: moneySchema.default(0),
  // Only meaningful when the product's priceEntryMode is NET_PAYABLE — the
  // seller-entered target net payable per unit. The server action converts
  // it to discountType/discountValue before applyProductSubmission; this
  // raw figure is persisted only so the edit form reopens in the same mode.
  netPayableAmount: moneySchema.optional(),
  minOrderQty: positiveIntSchema.default(1),
  currentStock: nonNegativeIntSchema.default(0),
  // Inventory-management thresholds (distinct from minOrderQty above,
  // which is a customer-facing "smallest quantity you may order" rule).
  // Cross-field check (reorderLevel > minStockQty) lives in
  // productSubmissionSchema's superRefine below, since it needs both
  // values together.
  minStockQty: nonNegativeIntSchema.default(5),
  reorderLevel: nonNegativeIntSchema.default(10),
  // Only meaningful for a non-variant product — a variant product tracks
  // this per variant instead (productVariantInputSchema.loyaltyPoints
  // below), same split as every other per-audience-config field here.
  loyaltyPoints: nonNegativeIntSchema.optional(),
  height: moneySchema.optional(),
  breadth: moneySchema.optional(),
  length: moneySchema.optional(),
  weight: weightGramsSchema.optional(),
  shippingCalcMode: shippingCalcModeEnum.default("INCLUDE_WITH_PRODUCT"),
  taxCalcMode: taxCalcModeEnum.default("INCLUDE_WITH_PRICE"),
});
export type ProductConfigInput = z.infer<typeof productConfigSchema>;

/**
 * One attribute+value pairing identifying a variant's position in the
 * combination matrix. Exported for reuse by the bulk-product-entry
 * translator (packages/catalog/src/bulk-product-submission.ts), which
 * assembles this exact shape from BulkProductRow rows.
 *
 * `slug` deliberately uses the exact same `slugSchema` (trim + lowercase +
 * hyphenated-format) that `productAttributeValueInputSchema.slug` below
 * uses — NOT a plain `z.string().min(1)`. The two used to diverge: an
 * attribute value's own slug got normalized on save, but a variant's ref
 * to that same value did not, so a slug typed with different
 * casing/whitespace in the two places (e.g. the value saved as "red" but
 * a ref carrying "Red " because the seller edited the slug field
 * directly) produced two DIFFERENT strings post-parse. `resolveVariantRows`
 * (packages/catalog/src/product-submission.ts) looks a ref's slug up
 * against a map keyed by the attribute value's own (normalized) slug, so
 * that mismatch made a variant referencing a value that genuinely WAS
 * submitted fail with "A variant referenced an attribute value that
 * wasn't submitted" — a real production bug, not just a display quirk.
 */
export const attributeValueRefSchema = z.object({
  attributeId: z.string().min(1),
  slug: slugSchema,
});

export const productImageInputSchema = z.object({
  // Present = update this exact existing ProductImage/VariantImage row
  // (reorder/activate); absent = create a new one. See product-form's
  // image manager (Product Card Design Spec "Images: Upload, reorder, set
  // default") — shared by both the product-level gallery and each
  // variant's own gallery (productVariantInputSchema.images below).
  id: z.string().optional(),
  url: mediaUrlSchema,
  altText: z.string().trim().optional().or(z.literal("")),
  position: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

const productVariantInputSchema = z.object({
  // Present = update this exact existing variant row; absent = create new.
  id: z.string().optional(),
  attributeValueRefs: z
    .array(attributeValueRefSchema)
    .min(1, "Select at least one attribute value"),
  sku: z.string().trim().min(1, "Enter or generate a variant SKU"),
  hsnCode: z.string().trim().min(1, "Enter an HSN code"),
  mrp: moneySchema,
  discountType: discountTypeEnum.default("NONE"),
  discountValue: moneySchema.default(0),
  // See productConfigSchema.netPayableAmount — same, per variant row.
  netPayableAmount: moneySchema.optional(),
  minOrderQty: positiveIntSchema.default(1),
  stockQty: nonNegativeIntSchema.default(0),
  minStockQty: nonNegativeIntSchema.default(5),
  reorderLevel: nonNegativeIntSchema.default(10),
  loyaltyPoints: nonNegativeIntSchema.optional(),
  height: moneySchema.optional(),
  breadth: moneySchema.optional(),
  length: moneySchema.optional(),
  weight: weightGramsSchema.optional(),
  shippingCalcMode: shippingCalcModeEnum.default("INCLUDE_WITH_PRODUCT"),
  taxCalcMode: taxCalcModeEnum.default("INCLUDE_WITH_PRICE"),
  // Optional per-variant PRIMARY/cover image — never required (a product
  // may have some variants with one and some without; a variant with none
  // falls back to the product's primaryImageUrl at read time, see
  // packages/catalog/src/queries.ts). Additional gallery images for the
  // same variant go in `images` below, mirroring primaryImageUrl vs
  // images at the product level.
  imageUrl: mediaUrlSchema.optional().or(z.literal("")),
  imageAlt: z.string().trim().optional().or(z.literal("")),
  images: z.array(productImageInputSchema).default([]),
  // Optional per-variant video — a variant with none falls back to the
  // product's own videoUrl at read time, same convention as imageUrl.
  videoUrl: videoUrlSchema.optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;

export const productStateAvailabilitySchema = z.object({
  // Empty = nationwide/"Pan India" — independently for each audience. A
  // client-submitted set covering every currently-active IndianState is
  // ALSO normalized to nationwide server-side — see
  // packages/catalog/src/product-submission.ts — so "Pan India" is never
  // trusted as a raw client boolean. Customer and Dealer availability are
  // never required to match (selling-licence module spec §6) — both are
  // also re-clamped server-side to whatever the seller's licence
  // eligibility actually allows, never trusted verbatim from the client
  // (see packages/catalog/src/product-submission.ts clampStateSelectionToEligibility).
  customerStateIds: z.array(z.string().min(1)).default([]),
  dealerStateIds: z.array(z.string().min(1)).default([]),
});

export const productImagesSectionSchema = z.object({
  primaryImageUrl: mediaUrlSchema,
  videoUrl: videoUrlSchema.optional().or(z.literal("")),
  images: z.array(productImageInputSchema).default([]),
});

// ---------------------------------------------------------------------------
// Product Card Design Spec §Admin Panel Controls — badge/subtitle/delivery-
// badge/availability-badge fields, folded into productSubmissionSchema
// below. ratingAverage/ratingCount are deliberately NOT here — they're a
// server-only denormalized cache (packages/catalog/src/ratings.ts), never
// an admin-editable input.
// ---------------------------------------------------------------------------

export const productBadgeToneEnum = z.enum(["SUCCESS", "WARNING", "DANGER", "INFO"]);
export const editorialBadgeKindEnum = z.enum(["EDITORIAL", "DEAL"]);
export const availabilityBadgeModeEnum = z.enum(["AUTOMATIC", "MANUAL", "OFF"]);

/** Admin → Site Settings editorial badge management (spec item #3) — see packages/db/prisma/schema.prisma's EditorialBadge doc comment for the kind/tone design. */
export const editorialBadgeInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a badge name"),
  slug: slugSchema,
  tone: productBadgeToneEnum.default("SUCCESS"),
  kind: editorialBadgeKindEnum.default("EDITORIAL"),
  position: z.coerce.number().int().default(0),
});
export type EditorialBadgeInput = z.infer<typeof editorialBadgeInputSchema>;

export const productCardMetaSchema = z.object({
  subtitle: z
    .string()
    .trim()
    .max(120, "Keep the subtitle to one short line")
    .optional()
    .or(z.literal("")),
  // Admin-only (spec: sellers must not manipulate merchandising fields) —
  // enforced server-side in applyProductSubmission, not just by hiding the
  // control in the form; empty string means "no badge", same convention
  // as the old enum field.
  editorialBadgeId: z.string().optional().or(z.literal("")),
  deliveryBadgeEnabled: z.boolean().default(false),
  deliveryBadgeText: z.string().trim().max(40).optional().or(z.literal("")),
  availabilityBadgeMode: availabilityBadgeModeEnum.default("AUTOMATIC"),
  availabilityBadgeText: z.string().trim().max(40).optional().or(z.literal("")),
});
export type ProductCardMetaInput = z.infer<typeof productCardMetaSchema>;

/** apps/dashboard's "set default variant" action — productId/audience are re-derived server-side from the variant row, never trusted from this input. */
export const variantDefaultInputSchema = z.object({
  variantId: z.string().min(1),
});
export type VariantDefaultInput = z.infer<typeof variantDefaultInputSchema>;

export const productSeoSchema = z.object({
  metaTitle: z
    .string()
    .trim()
    .max(70, "Keep meta title under 70 characters")
    .optional()
    .or(z.literal("")),
  metaDescription: z
    .string()
    .trim()
    .max(160, "Keep meta description under 160 characters")
    .optional()
    .or(z.literal("")),
  metaImageUrl: mediaUrlSchema.optional().or(z.literal("")),
  canonicalUrl: mediaUrlSchema.optional().or(z.literal("")),
});

/**
 * The full submission shape — one object combining every section from the
 * product form. Cross-field rules that can't be expressed on an isolated
 * section (discount bounds, customer/dealer config required by audience,
 * duplicate variant combinations/SKUs) are all checked here in one
 * `superRefine` pass.
 */
export const productSubmissionSchema = z
  .object({
    // Only ever a client-minted crypto.randomUUID() used as this product's
    // real primary key when the seller uploads an image before the product
    // is ever saved — see apps/dashboard/src/components/product-form.tsx
    // and packages/catalog/src/product-submission.ts's SubmissionContext.
    // Ignored entirely on UPDATE (the real id is already known and passed
    // separately). Shape-checked, never trusted as free text into a path/PK.
    id: z
      .string()
      .regex(/^[a-zA-Z0-9-]{8,64}$/)
      .optional(),
    ...productGeneralSchema.shape,
    ...productTranslationsSectionSchema.shape,
    ...productCategorySelectionSchema.shape,
    ...productBrandSelectionSchema.shape,
    ...productAudienceSectionSchema.shape,
    customerConfig: productConfigSchema.optional(),
    dealerConfig: productConfigSchema.optional(),
    // One shared product-scoped value pool — customer and dealer variants
    // both reference into it via attributeValueRefs, but the VARIANT rows
    // themselves stay fully separate (see VariantAudience in the schema).
    attributeValues: z.array(productAttributeValueInputSchema).default([]),
    customerVariants: z.array(productVariantInputSchema).default([]),
    dealerVariants: z.array(productVariantInputSchema).default([]),
    ...productStateAvailabilitySchema.shape,
    ...productImagesSectionSchema.shape,
    ...productCardMetaSchema.shape,
    ...productSeoSchema.shape,
  })
  .superRefine((data, ctx) => {
    if (data.availabilityBadgeMode === "MANUAL" && !data.availabilityBadgeText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the availability badge text, or switch the mode back to Automatic.",
        path: ["availabilityBadgeText"],
      });
    }
    const needsCustomer =
      data.audience === "CUSTOMER_ONLY" || data.audience === "BOTH_CUSTOMER_AND_DEALER";
    const needsDealer =
      data.audience === "DEALER_ONLY" || data.audience === "BOTH_CUSTOMER_AND_DEALER";
    const hasVariants = data.customerVariants.length > 0 || data.dealerVariants.length > 0;
    const isNetPayable = data.priceEntryMode === "NET_PAYABLE";

    // One sellable unit's pricing inputs. In SELLING_PRICE mode the seller
    // typed mrp+discount directly, so the ordinary discount-bounds check
    // applies. In NET_PAYABLE mode discountType/discountValue are derived
    // server-side from netPayableAmount (which the server also validates
    // against MRP once it has the settlement rates) — here we only ensure
    // the seller actually supplied a positive net payable and a weight
    // (the derived price depends materially on the logistics slab).
    const checkPricingUnit = (
      unit: {
        mrp: number;
        discountType: DiscountTypeInput;
        discountValue: number;
        netPayableAmount?: number;
        weight?: number;
      },
      basePath: (string | number)[],
    ) => {
      if (isNetPayable) {
        if (unit.netPayableAmount == null || unit.netPayableAmount <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Enter the net payable amount for this unit.",
            path: [...basePath, "netPayableAmount"],
          });
        }
        if (unit.weight == null || unit.weight <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Enter a weight — the net-payable price can't be worked out without the logistics charge.",
            path: [...basePath, "weight"],
          });
        }
        return;
      }
      const message = validateDiscountInput(unit.mrp, unit.discountType, unit.discountValue);
      if (message) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [...basePath, "discountValue"] });
      }
    };

    if (!hasVariants && !data.packageSize?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a package size, e.g. "500 ml"',
        path: ["packageSize"],
      });
    }

    if (needsCustomer && !data.customerConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Customer configuration is required for this audience.",
        path: ["customerConfig"],
      });
    }
    if (needsDealer && !data.dealerConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dealer configuration is required for this audience.",
        path: ["dealerConfig"],
      });
    }
    if (data.customerConfig) {
      checkPricingUnit(data.customerConfig, ["customerConfig"]);
      if (data.customerConfig.reorderLevel <= data.customerConfig.minStockQty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reorder level must be greater than minimum quantity.",
          path: ["customerConfig", "reorderLevel"],
        });
      }
      const skuResult = normalizeAudienceSku(data.customerConfig.sku, "CUSTOMER");
      if (!skuResult.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: skuResult.error,
          path: ["customerConfig", "sku"],
        });
      }
    }
    if (data.dealerConfig) {
      checkPricingUnit(data.dealerConfig, ["dealerConfig"]);
      if (data.dealerConfig.reorderLevel <= data.dealerConfig.minStockQty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reorder level must be greater than minimum quantity.",
          path: ["dealerConfig", "reorderLevel"],
        });
      }
      const skuResult = normalizeAudienceSku(data.dealerConfig.sku, "DEALER");
      if (!skuResult.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: skuResult.error,
          path: ["dealerConfig", "sku"],
        });
      }
    }
    if (!needsCustomer && data.customerVariants.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This audience does not include customer variants.",
        path: ["customerVariants"],
      });
    }
    if (!needsDealer && data.dealerVariants.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This audience does not include dealer variants.",
        path: ["dealerVariants"],
      });
    }

    for (const [key, variants, variantAudience] of [
      ["customerVariants", data.customerVariants, "CUSTOMER"],
      ["dealerVariants", data.dealerVariants, "DEALER"],
    ] as const) {
      const seenCombinations = new Set<string>();
      const seenSkus = new Set<string>();
      variants.forEach((variant, index) => {
        checkPricingUnit(variant, [key, index]);
        if (variant.reorderLevel <= variant.minStockQty) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Reorder level must be greater than minimum quantity.",
            path: [key, index, "reorderLevel"],
          });
        }
        const combinationKey = combinationKeyFromRefs(variant.attributeValueRefs);
        if (seenCombinations.has(combinationKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate attribute-value combination in this variant list.",
            path: [key, index, "attributeValueRefs"],
          });
        }
        seenCombinations.add(combinationKey);
        if (seenSkus.has(variant.sku)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate SKU in this variant list.",
            path: [key, index, "sku"],
          });
        }
        seenSkus.add(variant.sku);
        const skuResult = normalizeAudienceSku(variant.sku, variantAudience);
        if (!skuResult.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: skuResult.error,
            path: [key, index, "sku"],
          });
        }
      });
    }
  });
export type ProductSubmissionInput = z.infer<typeof productSubmissionSchema>;
/**
 * The pre-coercion shape — money/int fields accept the raw strings HTML
 * form inputs actually produce (z.coerce.number() parses them server-side
 * via `.safeParse`). Server actions should type their parameter as this,
 * not the post-parse `ProductSubmissionInput`, since the client never has
 * validated numbers to send in the first place.
 */
export type ProductSubmissionRawInput = z.input<typeof productSubmissionSchema>;

/**
 * The "save at any point" draft path — the only thing ever required is a
 * product name; every other field a real submission needs (slug, sku,
 * hsnCode, category, packageSize, primaryImageUrl, audience, baseUnit,
 * customer/dealer config, variant sku/hsnCode/mrp/attributeValueRefs) is
 * optional here. Built from `.partial()` on the exact same sub-schemas
 * `productSubmissionSchema` uses — a field that IS supplied still goes
 * through the same validator (moneySchema, mediaUrlSchema, etc.), so this
 * relaxes REQUIREDNESS only, never format/range correctness. No
 * `superRefine` here — a draft is never required to be internally
 * consistent (e.g. a customerConfig with no matching audience) — see
 * packages/catalog/src/product-draft.ts's fillDraftDefaults, which turns
 * this into a fully-valid `ProductSubmissionInput` by filling safe
 * placeholders, and packages/catalog/src/product-decisions.ts's
 * assertProductComplete, which is the actual gate: full correctness is
 * only enforced once, at DRAFT -> SUBMITTED time, not on every save.
 *
 * `.partial()` only ever excuses an ABSENT (`undefined`) key — every field
 * the product form's React state manages defaults to `""`, never
 * `undefined`, so an untouched Slug/SKU/HSN/... input still arrives here as
 * an empty string and would otherwise still hit that field's real
 * validator (e.g. slugSchema's regex) and fail. `stripEmptyStrings` below
 * recursively turns every `""` (at any nesting depth — including inside
 * customerConfig/dealerConfig and variant rows) into `undefined` before
 * the object schema ever sees it, so "left blank" and "not sent" are
 * treated identically here — exactly what a draft needs. This preprocessing
 * step is deliberately scoped to this schema alone: `productSubmissionSchema`
 * (the strict one, used for the real "Submit for approval" validation)
 * must keep rejecting an empty required field, not silently excuse it.
 */
function stripEmptyStrings(value: unknown): unknown {
  if (value === "") return undefined;
  if (Array.isArray(value)) return value.map(stripEmptyStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripEmptyStrings(v)]),
    );
  }
  return value;
}

const productDraftSubmissionObjectSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9-]{8,64}$/)
    .optional(),
  ...productGeneralSchema.partial({
    slug: true,
    sku: true,
    hsnCode: true,
    shortDescription: true,
    description: true,
    baseUnit: true,
    packageSize: true,
  }).shape,
  ...productTranslationsSectionSchema.shape,
  ...productCategorySelectionSchema.partial({ categoryId: true }).shape,
  ...productBrandSelectionSchema.shape,
  ...productAudienceSectionSchema.partial({ audience: true }).shape,
  customerConfig: productConfigSchema.partial({ sku: true, hsnCode: true, mrp: true }).optional(),
  dealerConfig: productConfigSchema.partial({ sku: true, hsnCode: true, mrp: true }).optional(),
  attributeValues: z.array(productAttributeValueInputSchema).default([]),
  customerVariants: z
    .array(
      productVariantInputSchema.partial({
        attributeValueRefs: true,
        sku: true,
        hsnCode: true,
        mrp: true,
      }),
    )
    .default([]),
  dealerVariants: z
    .array(
      productVariantInputSchema.partial({
        attributeValueRefs: true,
        sku: true,
        hsnCode: true,
        mrp: true,
      }),
    )
    .default([]),
  ...productStateAvailabilitySchema.shape,
  ...productImagesSectionSchema.partial({ primaryImageUrl: true }).shape,
  ...productCardMetaSchema.shape,
  ...productSeoSchema.shape,
});
export const productDraftSubmissionSchema = z.preprocess(
  stripEmptyStrings,
  productDraftSubmissionObjectSchema,
);
export type ProductDraftSubmissionInput = z.infer<typeof productDraftSubmissionSchema>;
export type ProductDraftSubmissionRawInput = z.input<typeof productDraftSubmissionSchema>;

// ---------------------------------------------------------------------------
// Admin decision
// ---------------------------------------------------------------------------

export const productDecisionSchema = z.object({
  productId: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT", "SUSPEND", "REACTIVATE", "DEACTIVATE"]),
  reason: z.string().trim().max(500).optional(),
});
export type ProductDecisionInput = z.infer<typeof productDecisionSchema>;
