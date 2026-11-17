import { z } from "zod";

// ---------------------------------------------------------------------------
// Admin-managed coupon module. Coupons created through this admin form are
// always platform-wide (Coupon.bearer = "ADMIN", sellerId = null) — the
// existing SELLER-bearer path on the Coupon model stays reserved/unused,
// out of scope here.
// ---------------------------------------------------------------------------

export const couponAudienceEnum = z.enum(["CUSTOMER_ONLY", "DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"]);
export const couponDiscountTypeEnum = z.enum(["FLAT", "PERCENTAGE"]);

const couponCodeSchema = z
  .string()
  .trim()
  .min(3, "Coupon code must be at least 3 characters")
  .max(40, "Coupon code is too long")
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9_-]+$/.test(v), "Use only letters, numbers, hyphens, and underscores");

export const couponInputSchema = z
  .object({
    code: couponCodeSchema,
    audience: couponAudienceEnum,
    discountType: couponDiscountTypeEnum,
    discountValue: z.coerce.number().positive("Enter a discount value greater than 0"),
    minPurchase: z.coerce.number().min(0).default(0),
    // Only meaningful when discountType is PERCENTAGE — caps the rupee
    // amount a percentage discount can knock off a large cart.
    maxDiscount: z.coerce.number().positive().optional(),
    usageLimit: z.coerce.number().int().positive().optional(),
    perUserLimit: z.coerce.number().int().positive().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.endDate.getTime() <= data.startDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be after the start date",
        path: ["endDate"],
      });
    }
    if (data.discountType === "PERCENTAGE" && data.discountValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A percentage discount can't exceed 100",
        path: ["discountValue"],
      });
    }
  });
export type CouponInput = z.infer<typeof couponInputSchema>;

export const couponUpdateSchema = couponInputSchema.and(z.object({ id: z.string().min(1) }));
export type CouponUpdateInput = z.infer<typeof couponUpdateSchema>;

export const couponToggleActiveSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export type CouponToggleActiveInput = z.infer<typeof couponToggleActiveSchema>;
