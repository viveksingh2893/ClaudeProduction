import { z } from "zod";
import {
  productAudienceEnum,
  baseUnitEnum,
  productTypeEnum,
  availabilityBadgeModeEnum,
  productAttributeValueInputSchema,
  productImageInputSchema,
  attributeValueRefSchema,
} from "./catalog";

/**
 * "Add Multiple Products" bulk-entry drafts — spec's own instruction:
 * "Do not store the bulk-entry data internally as an uncontrolled flat
 * spreadsheet. Persist it as structured product-group and sellable-row
 * draft data." These are deliberately PERMISSIVE draft-save schemas (an
 * in-progress row is allowed to be incomplete — that's the whole point of
 * a draft) — every field defaults to an empty/safe value rather than
 * failing to parse. Real business-rule validation (MRP <= sellingPrice,
 * SKU suffix correctness, tax 0-100, state exclusivity, dealer-shipping-
 * locked, etc.) is never duplicated here: packages/catalog/src/
 * bulk-product-submission.ts translates a group + its rows into the exact
 * same ProductSubmissionInput shape the single-product form produces and
 * re-validates it through productSubmissionSchema — the one place those
 * rules live, so the two entry points can never drift apart (spec: "The
 * normal single-product form and the bulk spreadsheet must ultimately use
 * the same business logic").
 */

export const bulkHasVariantsEnum = z.enum(["YES", "NO"]);
export type BulkHasVariants = z.infer<typeof bulkHasVariantsEnum>;

export const bulkShippingIncludedEnum = z.enum(["YES", "NO"]);

/** Display-only units the grid accepts — always converted to the schema's real storage units (grams, metres) at the group/row -> submission translation boundary, never stored as-is. */
export const bulkWeightUnitEnum = z.enum(["G", "KG"]);
export const bulkDimensionUnitEnum = z.enum(["CM", "M"]);

export const bulkGroupSharedDataSchema = z.object({
  name: z.string().default(""),
  slug: z.string().default(""),
  productType: productTypeEnum.default("PHYSICAL"),
  baseUnit: baseUnitEnum.optional(),
  hasVariants: bulkHasVariantsEnum.default("NO"),
  audience: productAudienceEnum.optional(),

  categoryId: z.string().default(""),
  subCategoryId: z.string().default(""),
  subSubCategoryId: z.string().default(""),
  brandId: z.string().default(""),
  manufacturerId: z.string().default(""),

  shortDescription: z.string().default(""),
  description: z.string().default(""),
  ingredients: z.string().default(""),
  howToUse: z.string().default(""),
  dosageInstructions: z.string().default(""),
  technicalInfo: z.string().default(""),
  searchTags: z.array(z.string()).default([]),
  subtitle: z.string().default(""),

  // Variant-product-only — blocked/ignored by the translator when
  // hasVariants is "NO" (spec: "Do not store fake attributes stored for
  // non-variant products").
  selectedAttributeIds: z.array(z.string()).default([]),
  attributeValues: z.array(productAttributeValueInputSchema).default([]),

  primaryImageUrl: z.string().default(""),
  images: z.array(productImageInputSchema).default([]),
  videoUrl: z.string().default(""),

  // State availability is a per-(product, audience) concept in the real
  // schema (Product.customerAvailableStates/dealerAvailableStates), not
  // per-variant — see this file's translator doc comment for why it lives
  // here at the group level rather than per row.
  customerStateIds: z.array(z.string()).default([]),
  dealerStateIds: z.array(z.string()).default([]),

  metaTitle: z.string().default(""),
  metaDescription: z.string().default(""),
  metaImageUrl: z.string().default(""),
  canonicalUrl: z.string().default(""),

  // Admin-only merchandising — a seller-authored draft must never carry a
  // non-empty value here past what the server-side enforcement in
  // applyProductSubmission already allows (same asAdmin gate as the
  // single-product form; see bulk-product-submission.ts).
  editorialBadgeId: z.string().default(""),
  deliveryBadgeEnabled: z.boolean().default(false),
  deliveryBadgeText: z.string().default(""),
  availabilityBadgeMode: availabilityBadgeModeEnum.default("AUTOMATIC"),
  availabilityBadgeText: z.string().default(""),
  featuredPosition: z.coerce.number().int().optional(),
});
export type BulkGroupSharedData = z.infer<typeof bulkGroupSharedDataSchema>;
export type BulkGroupSharedDataInput = z.input<typeof bulkGroupSharedDataSchema>;

export const bulkRowDataSchema = z.object({
  // Only meaningful when the group's hasVariants is "YES" — one ref per
  // selected attribute, matching productVariantInputSchema's shape.
  attributeValueRefs: z.array(attributeValueRefSchema).default([]),

  skuBase: z.string().default(""),
  hsnCode: z.string().default(""),

  mrp: z.string().default(""),
  sellingPrice: z.string().default(""),
  taxPercent: z.string().default("0"),

  minOrderQty: z.string().default("1"),
  currentStock: z.string().default("0"),
  minStockQty: z.string().default("5"),
  reorderLevel: z.string().default("10"),

  weight: z.string().default(""),
  weightUnit: bulkWeightUnitEnum.default("G"),
  height: z.string().default(""),
  breadth: z.string().default(""),
  length: z.string().default(""),
  dimensionUnit: bulkDimensionUnitEnum.default("CM"),
  shippingIncluded: bulkShippingIncludedEnum.default("YES"),

  imageUrl: z.string().default(""),
  imageAlt: z.string().default(""),

  isActive: z.boolean().default(true),
});
export type BulkRowData = z.infer<typeof bulkRowDataSchema>;
export type BulkRowDataInput = z.input<typeof bulkRowDataSchema>;

/** Server-side re-validation for a draft write (autosave/manual save) — parses with defaults rather than rejecting, since a draft is allowed to be incomplete; malformed JSON shape (wrong types) is the only thing this actually catches. */
export function parseBulkGroupSharedData(input: unknown): BulkGroupSharedData {
  return bulkGroupSharedDataSchema.parse(input ?? {});
}
export function parseBulkRowData(input: unknown): BulkRowData {
  return bulkRowDataSchema.parse(input ?? {});
}
