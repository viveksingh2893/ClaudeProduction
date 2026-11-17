"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  RatingSummary,
  StarRatingDisplay,
  StarRatingInput,
  FormTextarea,
  AlertBox,
  Badge,
} from "@kisan4u/ui";

type SubmitReviewResult = { ok: true } | { ok: false; error: string };

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  verifiedPurchase: boolean;
  source: "WEBSITE" | "MANUAL_OFFLINE";
  manualCustomerName: string | null;
  createdAt: Date | string;
  customerName: string | null;
};

export type MyReview = { id: string; rating: number; comment: string | null } | null;

export function ProductReviews({
  productId,
  onSubmit,
  ratingAverage,
  ratingCount,
  reviews,
  canReview,
  ineligibleReason,
  myReview,
  isLoggedIn,
}: {
  productId: string;
  /**
   * Left to the caller (customer vs. dealer product-detail page) rather
   * than imported directly — both routes call the same audience-agnostic
   * submitProductReview underneath, but each needs its OWN revalidatePath
   * target (its own route), so each page supplies its own bound server
   * action. See apps/web/src/app/products/[slug]/review-actions.ts and
   * apps/web/src/app/dealer/products/[id]/review-actions.ts.
   */
  onSubmit: (input: {
    productId: string;
    rating: number;
    comment?: string;
  }) => Promise<SubmitReviewResult>;
  ratingAverage: number | null;
  ratingCount: number;
  reviews: PublicReview[];
  /** Server-verified: this account owns a delivered order containing this product and hasn't already... well, may already have a review (see myReview, which makes the form an edit instead). */
  canReview: boolean;
  ineligibleReason?: string;
  myReview: MyReview;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [rating, setRating] = useState(myReview?.rating ?? 5);
  const [comment, setComment] = useState(myReview?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onSubmit({ productId, rating, comment });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      setFormOpen(false);
      router.refresh();
    });
  }

  const verifiedReviews = reviews.filter((r) => r.verifiedPurchase);
  const feedbackReviews = reviews.filter((r) => !r.verifiedPurchase);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-extrabold text-green-800">Ratings & reviews</h2>
          <RatingSummary average={ratingAverage} count={ratingCount} size="lg" />
        </div>
        {isLoggedIn && canReview && !formOpen && (
          <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen(true)}>
            {myReview ? "Edit your review" : "Write a review"}
          </Button>
        )}
      </div>

      {!isLoggedIn && (
        <AlertBox tone="info">
          Log in and complete a delivered order for this product to leave a verified review.
        </AlertBox>
      )}
      {isLoggedIn && !canReview && !myReview && (
        <AlertBox tone="info">
          {ineligibleReason ?? "You can review a product once it's been delivered to you."}
        </AlertBox>
      )}
      {success && (
        <AlertBox tone="success">
          Thanks — your review is saved and will appear once moderated.
        </AlertBox>
      )}

      {formOpen && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-gray-600">Your rating</span>
            <StarRatingInput value={rating} onChange={setRating} size="lg" />
          </div>
          <FormTextarea
            label="Your review"
            hint="Optional"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={isPending}>
              Submit review
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {verifiedReviews.length === 0 && feedbackReviews.length === 0 ? (
        <p className="text-sm text-gray-500">
          No reviews yet — be the first to share your experience.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {verifiedReviews.length > 0 && (
            <ul className="flex flex-col gap-4">
              {verifiedReviews.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </ul>
          )}
          {feedbackReviews.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">
                Customer feedback
              </h3>
              <ul className="flex flex-col gap-4">
                {feedbackReviews.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: PublicReview }) {
  const name = review.customerName ?? review.manualCustomerName ?? "Kisan4U customer";
  return (
    <li className="flex flex-col gap-1.5 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <StarRatingDisplay average={review.rating} />
        <span className="text-sm font-bold text-ink">{name}</span>
        {review.verifiedPurchase ? (
          <Badge tone="success">Verified purchase</Badge>
        ) : (
          <Badge tone="neutral">Customer feedback</Badge>
        )}
        <span className="text-xs text-gray-400">
          {new Date(review.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      {review.comment && <p className="text-sm text-gray-700">{review.comment}</p>}
    </li>
  );
}
