import { z } from "zod";
import { positiveIntSchema } from "./primitives";

/**
 * Deliberately does NOT accept price, sellerId, or weight from the
 * client — every mutation re-derives those from the database (see Phase 4
 * spec §B3). Only the product/variant identity and the requested quantity
 * ever come from the browser.
 */
export const addToCartInputSchema = z.object({
  productId: z.string().min(1, "Missing product"),
  variantId: z.string().min(1).optional(),
  quantity: positiveIntSchema.default(1),
});
export type AddToCartInput = z.infer<typeof addToCartInputSchema>;
export type AddToCartRawInput = z.input<typeof addToCartInputSchema>;

export const updateCartItemQuantityInputSchema = z.object({
  cartItemId: z.string().min(1),
  quantity: positiveIntSchema,
});
export type UpdateCartItemQuantityInput = z.infer<typeof updateCartItemQuantityInputSchema>;

export const removeCartItemInputSchema = z.object({
  cartItemId: z.string().min(1),
});
export type RemoveCartItemInput = z.infer<typeof removeCartItemInputSchema>;
