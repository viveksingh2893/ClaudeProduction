import { z } from "zod";
import { mediaUrlSchema } from "./primitives";
import { dbLanguageEnum } from "./language";

export const homepageSectionTypeEnum = z.enum([
  "HERO_BANNER",
  "TRUST_STRIP",
  "COUPON_STRIP",
  "TOP_CATEGORIES",
  "DEAL_OF_THE_DAY",
  "PRODUCT_DISCOVERY_TRENDING",
  "PRODUCT_DISCOVERY_BEST_SELLERS",
  "PRODUCT_DISCOVERY_NEW_ARRIVALS",
  "JOIN_DEALER_SELLER",
  "FEATURED_BY_CATEGORY",
  "SHOP_BY_BRAND",
]);
export const sectionAudienceEnum = z.enum(["CUSTOMER", "DEALER", "COMMON"]);
export const promotionalPlacementEnum = z.enum([
  "HERO",
  "COUPON",
  "HERO_SECONDARY",
  "JOIN_DEALER",
  "JOIN_SELLER",
]);
export const merchandisingTypeEnum = z.enum([
  "TRENDING",
  "BEST_SELLERS",
  "NEW_ARRIVALS",
  "FEATURED_BY_CATEGORY",
]);
export const merchandisingModeEnum = z.enum(["MANUAL", "AUTOMATIC"]);

export const homepageSectionInputSchema = z
  .object({
    id: z.string().min(1),
    position: z.coerce.number().int().default(0),
    enabled: z.boolean().default(true),
    audience: sectionAudienceEnum.default("COMMON"),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startAt && data.endAt && data.startAt >= data.endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start must be before end.",
        path: ["endAt"],
      });
    }
  });
export type HomepageSectionInput = z.infer<typeof homepageSectionInputSchema>;

export const promotionalAssetInputSchema = z
  .object({
    id: z.string().optional(),
    placement: promotionalPlacementEnum,
    audience: sectionAudienceEnum.default("COMMON"),
    language: dbLanguageEnum.default("EN"),
    // "" / absent = storefront home page; a category id = that category's page.
    categoryId: z.string().optional().or(z.literal("")),
    desktopImageUrl: mediaUrlSchema,
    mobileImageUrl: mediaUrlSchema.optional().or(z.literal("")),
    altText: z.string().trim().min(1, "Enter alt text for accessibility"),
    linkUrl: mediaUrlSchema.optional().or(z.literal("")),
    ctaLabel: z.string().trim().max(40).optional().or(z.literal("")),
    priority: z.coerce.number().int().default(0),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.startAt && data.endAt && data.startAt >= data.endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start must be before end.",
        path: ["endAt"],
      });
    }
  });
export type PromotionalAssetInput = z.infer<typeof promotionalAssetInputSchema>;
export type PromotionalAssetRawInput = z.input<typeof promotionalAssetInputSchema>;

/**
 * Focused schema for the dedicated admin Banners tab — a deliberately
 * smaller surface than promotionalAssetInputSchema (no placement/audience/
 * ctaLabel/schedule fields): every banner created here is placement="HERO",
 * audience="COMMON" server-side (see apps/dashboard's admin/banners/actions.ts).
 * `priority` is exposed to the admin as "display order" — same field, same
 * PromotionalAsset row, just a form-facing rename.
 */
export const bannerInputSchema = z.object({
  id: z.string().optional(),
  desktopImageUrl: mediaUrlSchema,
  mobileImageUrl: mediaUrlSchema.optional().or(z.literal("")),
  altText: z.string().trim().min(1, "Enter alt text for accessibility"),
  linkUrl: mediaUrlSchema.optional().or(z.literal("")),
  // "" / absent = the storefront home page ("Home page / All"); a category
  // id = that category's own page (Homepage redesign, phase A).
  categoryId: z.string().optional().or(z.literal("")),
  priority: z.coerce
    .number()
    .int("Display order must be a whole number")
    .min(0, "Display order must be zero or greater")
    .default(0),
  isActive: z.boolean().default(true),
});
export type BannerInput = z.infer<typeof bannerInputSchema>;
export type BannerRawInput = z.input<typeof bannerInputSchema>;

export const categoryHomepageAssetInputSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1, "Select a category"),
  // Deliberately separate from Category.imageUrl (Complete Design/Admin
  // Spec §7.4/§11.4: "do not overwrite the standard category image").
  imageUrl: mediaUrlSchema,
  position: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type CategoryHomepageAssetInput = z.infer<typeof categoryHomepageAssetInputSchema>;

export const dealOfTheDayInputSchema = z
  .object({
    id: z.string().optional(),
    productId: z.string().min(1, "Select a product"),
    variantId: z.string().optional().or(z.literal("")),
    dealPrice: z.coerce.number().positive("Enter a deal price greater than zero"),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.startAt >= data.endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start must be before end.",
        path: ["endAt"],
      });
    }
  });
export type DealOfTheDayInput = z.infer<typeof dealOfTheDayInputSchema>;
export type DealOfTheDayRawInput = z.input<typeof dealOfTheDayInputSchema>;

export const merchandisingCollectionInputSchema = z.object({
  type: merchandisingTypeEnum,
  mode: merchandisingModeEnum.default("AUTOMATIC"),
  categoryId: z.string().optional().or(z.literal("")), // required for FEATURED_BY_CATEGORY, absent otherwise
  isActive: z.boolean().default(true),
});
export type MerchandisingCollectionInput = z.infer<typeof merchandisingCollectionInputSchema>;

/** Ordered product-id list — position is implicit array order, matching the product-picker UI's reorderable list. */
export const merchandisingItemsInputSchema = z.object({
  collectionId: z.string().min(1),
  productIds: z.array(z.string().min(1)).max(10, "At most 10 products per collection"),
});
export type MerchandisingItemsInput = z.infer<typeof merchandisingItemsInputSchema>;

export const brandHomepagePositionInputSchema = z.object({
  brandId: z.string().min(1),
  homepagePosition: z.coerce.number().int().min(0).nullable(),
});
export type BrandHomepagePositionInput = z.infer<typeof brandHomepagePositionInputSchema>;

/**
 * The three manually-curated homepage product sections managed from
 * /admin/products (see packages/catalog/src/product-placement.ts) —
 * deliberately a narrower enum than merchandisingTypeEnum: FEATURED_BY_CATEGORY
 * is a different, category-scoped collection kind, not editable through
 * this per-product placement surface.
 */
export const productPlacementSectionEnum = z.enum(["TRENDING", "BEST_SELLERS", "NEW_ARRIVALS"]);
export const productSectionPlacementInputSchema = z.object({
  productId: z.string().min(1),
  section: productPlacementSectionEnum,
  // null = "Not displayed" (remove from the section); otherwise 1-10, or
  // 1-12 for BEST_SELLERS (the section-level cap is re-checked server-side
  // in setProductSectionPlacement).
  position: z.coerce.number().int().min(1).max(12).nullable(),
});
export type ProductSectionPlacementInput = z.infer<typeof productSectionPlacementInputSchema>;

/** Per-product "category rank" — position 1-10 inside the FEATURED_BY_CATEGORY collection for the product's OWN category (resolved server-side). */
export const productCategoryPlacementInputSchema = z.object({
  productId: z.string().min(1),
  position: z.coerce.number().int().min(1).max(10).nullable(),
});
export type ProductCategoryPlacementInput = z.infer<typeof productCategoryPlacementInputSchema>;
