import { z } from "zod";
import { moneySchema } from "./primitives";

/**
 * Phase 3 fix: selling price is never entered directly anywhere in the
 * app — it's always derived from mrp + discountType + discountValue. NONE
 * means sellingPrice === mrp. This file has no dependency on Prisma/DB so
 * it's safe to import from client components too (for a live computed
 * preview) as well as from server actions (for the authoritative
 * calculation) — see packages/catalog/src/product-submission.ts.
 */
export const discountTypeEnum = z.enum(["NONE", "FLAT", "PERCENTAGE"]);
export type DiscountTypeInput = z.infer<typeof discountTypeEnum>;

/**
 * Rounds to 2 decimal places the same way everywhere money is displayed —
 * plain JS number arithmetic is fine at this precision for a display/
 * calculation value that Prisma will store as Decimal on save; this
 * function is the single place that rounding happens so it can't drift
 * between client preview and server-authoritative calculation.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateSellingPrice(
  mrp: number,
  discountType: DiscountTypeInput,
  discountValue: number,
): number {
  let raw: number;
  switch (discountType) {
    case "NONE":
      raw = mrp;
      break;
    case "FLAT":
      raw = mrp - discountValue;
      break;
    case "PERCENTAGE":
      raw = mrp - (mrp * discountValue) / 100;
      break;
  }
  return round2(Math.max(0, raw));
}

/**
 * Pure validation (no Zod context needed) so it can be reused both as a
 * standalone check and inside a larger `superRefine` (see
 * packages/validators/src/catalog.ts, which applies this to customer/dealer
 * base config and to every variant without needing to nest a
 * pre-refined sub-schema — Zod's `.extend()` doesn't compose after
 * `.superRefine()`, so a plain function is the simpler shared primitive).
 */
export function validateDiscountInput(
  mrp: number,
  discountType: DiscountTypeInput,
  discountValue: number,
): string | null {
  if (discountType === "FLAT" && discountValue > mrp) return "Flat discount cannot exceed MRP.";
  if (discountType === "PERCENTAGE" && (discountValue < 0 || discountValue > 100)) {
    return "Percentage discount must be between 0 and 100.";
  }
  return null;
}

/** Standalone mrp+discount shape, for callers that don't need to nest it in a larger superRefine. */
export const discountedPriceSchema = z
  .object({
    mrp: moneySchema,
    discountType: discountTypeEnum.default("NONE"),
    discountValue: moneySchema.default(0),
  })
  .superRefine((data, ctx) => {
    const message = validateDiscountInput(data.mrp, data.discountType, data.discountValue);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["discountValue"] });
  });
