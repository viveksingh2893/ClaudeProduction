import { z } from "zod";

const percent0to100 = z.coerce.number().min(0, "Must be 0 or greater").max(100, "Must be 100 or less");

/** The PosPricingConfig singleton — admin-configurable discount rate per POS payment mode. */
export const posPricingConfigInputSchema = z.object({
  codDiscountPercent: percent0to100.default(0),
  fullPrepaidDiscountPercent: percent0to100.default(5),
  partialPrepaidDiscountPercent: percent0to100.default(2),
});
export type PosPricingConfigInput = z.infer<typeof posPricingConfigInputSchema>;
