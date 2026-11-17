import { z } from "zod";

export const submitReviewInputSchema = z.object({
  productId: z.string().min(1, "Missing product."),
  rating: z.number().int().min(1, "Rating must be between 1 and 5.").max(5, "Rating must be between 1 and 5."),
  comment: z.string().trim().max(2000).optional(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>;
