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
 * Dealer-page sibling of apps/web/src/app/products/[slug]/review-actions.ts
 * — same underlying submitProductReview (audience-agnostic: a DEALER role
 * account is exactly as eligible as a CUSTOMER one, see that function),
 * just revalidating this route's own path instead of the customer one.
 * `productId` comes first so the page can pass a bound server-action
 * reference — `submitDealerReviewAction.bind(null, product.id)` — to the
 * shared ProductReviews Client Component; see the customer review-actions.ts
 * doc comment for why a plain closure over `productId` doesn't work here.
 */
export async function submitDealerReviewAction(
  productId: string,
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
  if (result.ok) revalidatePath(`/dealer/products/${productId}`);
  return result;
}

export async function getDealerReviewEligibilityAction(productId: string) {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  return checkReviewEligibility(session.user.id, productId);
}

export async function getMyDealerReviewAction(productId: string) {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  return getCustomerReviewForProduct(session.user.id, productId);
}
