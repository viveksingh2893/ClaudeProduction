"use server";

import { revalidatePath } from "next/cache";
import {
  submitProductReview,
  checkReviewEligibility,
  getCustomerReviewForProduct,
} from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Only `productId`/`rating`/`comment` ever come from the client — who's
 * submitting (`userId`) is always the authenticated session, never a
 * client-supplied id, and eligibility (owns a delivered order containing
 * this product) is re-verified server-side inside submitProductReview on
 * every call. A customer can never review as, or impersonate, anyone else.
 */
/**
 * `productSlug` comes first so the page can pass a bound reference —
 * `submitReviewAction.bind(null, slug)` — to the ProductReviews Client
 * Component. A server action reference is one of the few function values
 * Next.js can serialize across the Server -> Client boundary; a plain
 * arrow function closing over `slug` (`(input) => submitReviewAction(input,
 * slug)`) is NOT, and throws "Event handlers cannot be passed to Client
 * Component props" at render time — this bound-first-arg shape is the
 * officially supported way to parameterize a server action passed as a
 * prop like this.
 */
export async function submitReviewAction(
  productSlug: string,
  input: { productId: string; rating: number; comment?: string },
): Promise<Result> {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  if (typeof input.productId !== "string" || !input.productId)
    return { ok: false, error: "Missing product." };
  if (typeof input.rating !== "number") return { ok: false, error: "Missing rating." };

  const result = await submitProductReview(session.user.id, {
    productId: input.productId,
    rating: input.rating,
    comment: typeof input.comment === "string" ? input.comment : undefined,
  });
  if (result.ok) revalidatePath(`/products/${productSlug}`);
  return result;
}

export async function getReviewEligibilityAction(productId: string) {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  return checkReviewEligibility(session.user.id, productId);
}

export async function getMyReviewAction(productId: string) {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  return getCustomerReviewForProduct(session.user.id, productId);
}
