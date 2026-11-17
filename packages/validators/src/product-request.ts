import { z } from "zod";
import { positiveIntSchema } from "./primitives";

/**
 * "Request This Product" — a dealer enquiry only (see
 * packages/catalog/src/product-requests.ts doc comment). Deliberately has
 * NO dealerId/sellerId/deliveryStateId field: the dealer comes from the
 * authenticated session, the seller is always re-derived from the product
 * row server-side, and the delivery state is always the dealer's own
 * verified DealerProfile.stateId — never trusted from client input. A
 * request only ever exists because the product is unavailable for exactly
 * that state, so letting the client pick a different state would defeat
 * the entire eligibility check.
 */
export const productRequestInputSchema = z.object({
  productId: z.string().min(1, "Select a product"),
  variantId: z.string().min(1).optional().or(z.literal("")),
  quantity: positiveIntSchema,
  deliveryAddress: z.string().trim().min(5, "Enter a delivery address"),
  /** Optional, purely informational — plain "YYYY-MM-DD" from a date input. */
  neededByDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .optional()
    .or(z.literal("")),
  note: z
    .string()
    .trim()
    .max(500, "Keep the requirement under 500 characters")
    .optional()
    .or(z.literal("")),
});
export type ProductRequestInput = z.infer<typeof productRequestInputSchema>;

/** Seller-side transition (VIEWED/RESPONDED/CLOSED) or dealer-side (CANCELLED) — which is allowed is enforced server-side by role, not by this schema. */
export const productRequestStatusSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["VIEWED", "RESPONDED", "CLOSED", "CANCELLED"]),
});
export type ProductRequestStatusInput = z.infer<typeof productRequestStatusSchema>;

/** Admin-only — approving requires a seller-safe summary; rejecting requires a reason. Both may carry an internal-only admin note. */
export const approveProductRequestInputSchema = z.object({
  requestId: z.string().min(1),
  sellerVisibleSummary: z.string().trim().min(1, "Write a seller-visible summary").max(1000),
  adminNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type ApproveProductRequestInput = z.infer<typeof approveProductRequestInputSchema>;

export const rejectProductRequestInputSchema = z.object({
  requestId: z.string().min(1),
  rejectionReason: z.string().trim().min(1, "Enter a rejection reason").max(1000),
  adminNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type RejectProductRequestInput = z.infer<typeof rejectProductRequestInputSchema>;
