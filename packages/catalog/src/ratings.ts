import { prisma } from "@kisan4u/db";

/**
 * Product Card Design Spec §Admin Panel Controls ("Ratings: Moderate and
 * set threshold"). Product.ratingAverage/ratingCount are a denormalized
 * cache — this is the ONE place that ever writes them, called by the
 * admin review-moderation action after every approve/reject/hide and by
 * the customer review-submission/edit action. Never computed inline in a
 * catalogue query (that would mean an aggregate query per product per
 * render).
 *
 * Deliberately requires BOTH moderationStatus = APPROVED AND
 * verifiedPurchase — the public "X out of 5 from N verified reviews"
 * figure must never include a MANUAL_OFFLINE entry or an unverified
 * WEBSITE review, even if a moderator approved it for display elsewhere
 * (approved-but-unverified reviews may still render in a general
 * "customer feedback" list — see listApprovedReviews — just never in
 * this aggregate).
 */
export async function recomputeProductRating(productId: string): Promise<void> {
  const result = await prisma.productReview.aggregate({
    where: { productId, moderationStatus: "APPROVED", verifiedPurchase: true },
    _avg: { rating: true },
    _count: true,
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      ratingAverage: result._count > 0 ? result._avg.rating : null,
      ratingCount: result._count,
    },
  });
}
