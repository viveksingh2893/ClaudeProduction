import { prisma, Prisma, ReviewModerationStatus, ReviewSource } from "@kisan4u/db";
import { recomputeProductRating } from "./ratings";

/** Strips markup and control characters and caps length -- reviews render as plain React text (auto-escaped) everywhere today, but this is defense-in-depth for any future export/email/CSV path that might not escape. */
const CONTROL_CHARS_PATTERN = "[\x00-\x08\x0B\x0C\x0E-\x1F]";
const CONTROL_CHARS = new RegExp(CONTROL_CHARS_PATTERN, "g");

export function sanitizeReviewText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, 2000);
}

export type ReviewEligibility =
  | { eligible: true; orderItemId: string; variantLabel: string | null }
  | { eligible: false; reason: string };

/**
 * THE single source of truth for "has this account earned the right to
 * review this product" — every submission path must call this, never
 * trust a client-supplied order/orderItem id. Looks for a delivered
 * SellerOrder (the only success-terminal OrderStatus this codebase
 * actually transitions orders into — see the enum's own doc comment)
 * owned by this exact customerId, containing a line item for this
 * product, whose refund status never reached the fully-refunded terminal
 * state (an in-progress return doesn't retroactively erase "they
 * received it," but a completed refund means they no longer have it).
 */
export async function checkReviewEligibility(
  customerId: string,
  productId: string,
): Promise<ReviewEligibility> {
  const orderItem = await prisma.orderItem.findFirst({
    where: {
      productId,
      refundStatus: { not: "REFUNDED" },
      sellerOrder: { customerId, status: "DELIVERED" },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, variantLabel: true },
  });
  if (!orderItem) {
    return {
      eligible: false,
      reason:
        "You can review a product only after an order containing it has been delivered to you.",
    };
  }
  return { eligible: true, orderItemId: orderItem.id, variantLabel: orderItem.variantLabel };
}

export type SubmitReviewInput = { productId: string; rating: number; comment?: string };
export type SubmitReviewResult = { ok: true; reviewId: string } | { ok: false; error: string };

/**
 * Create-or-edit in one call (upsert on the (customerId, productId)
 * unique constraint) — "one active review per account per product," a
 * second submission edits the first rather than creating a duplicate.
 * Editing resets moderationStatus to PENDING even if the prior version
 * was already APPROVED: the previously-approved text is not what's about
 * to go live, so it must clear moderation again before it's public —
 * otherwise a customer could get one review approved, then silently
 * rewrite it into something a moderator never saw.
 */
export async function submitProductReview(
  customerId: string,
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "Rating must be a whole number from 1 to 5." };
  }
  const comment = input.comment ? sanitizeReviewText(input.comment) : null;

  const eligibility = await checkReviewEligibility(customerId, input.productId);
  if (!eligibility.eligible) return { ok: false, error: eligibility.reason };

  const variantSnapshot = eligibility.variantLabel
    ? { label: eligibility.variantLabel }
    : Prisma.JsonNull;

  const review = await prisma.productReview.upsert({
    where: { customerId_productId: { customerId, productId: input.productId } },
    create: {
      productId: input.productId,
      customerId,
      rating: input.rating,
      comment,
      orderItemId: eligibility.orderItemId,
      variantSnapshot,
      verifiedPurchase: true,
      source: ReviewSource.WEBSITE,
      moderationStatus: ReviewModerationStatus.PENDING,
    },
    update: {
      rating: input.rating,
      comment,
      orderItemId: eligibility.orderItemId,
      variantSnapshot,
      verifiedPurchase: true,
      moderationStatus: ReviewModerationStatus.PENDING,
    },
  });

  // The prior version may have been counted in the public aggregate
  // (if APPROVED) and no longer is (now PENDING again) — always
  // recompute, not just on the create path.
  await recomputeProductRating(input.productId);
  return { ok: true, reviewId: review.id };
}

export async function getCustomerReviewForProduct(customerId: string, productId: string) {
  return prisma.productReview.findUnique({
    where: { customerId_productId: { customerId, productId } },
  });
}

// --- Public (storefront) reads -------------------------------------------

/** Only ever APPROVED reviews — PENDING/REJECTED/HIDDEN must never reach a public page. */
export async function getPublicReviewsForProduct(
  productId: string,
  { page = 1, pageSize = 10 }: { page?: number; pageSize?: number } = {},
) {
  const where: Prisma.ProductReviewWhereInput = {
    productId,
    moderationStatus: ReviewModerationStatus.APPROVED,
  };
  const [rows, total] = await Promise.all([
    prisma.productReview.findMany({
      where,
      select: {
        id: true,
        rating: true,
        comment: true,
        verifiedPurchase: true,
        source: true,
        manualCustomerName: true,
        variantSnapshot: true,
        createdAt: true,
        customer: { select: { firstName: true, lastName: true, deletedAt: true } },
      },
      orderBy: [{ verifiedPurchase: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.productReview.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

// --- Admin ------------------------------------------------------------------

export type AdminReviewSortKey = "createdAt" | "rating" | "moderationStatus";

/** Whitelisted — never pass a raw query-string value straight into `orderBy`. */
const ADMIN_REVIEW_SORT: Record<
  AdminReviewSortKey,
  keyof Prisma.ProductReviewOrderByWithRelationInput
> = {
  createdAt: "createdAt",
  rating: "rating",
  moderationStatus: "moderationStatus",
};

export type AdminReviewFilters = {
  q?: string;
  moderationStatus?: ReviewModerationStatus;
  rating?: number;
  verifiedPurchase?: boolean;
  source?: ReviewSource;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

export async function listReviewsForAdmin(filters: AdminReviewFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_REVIEW_SORT
      ? ADMIN_REVIEW_SORT[filters.sortKey as AdminReviewSortKey]
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";

  const q = filters.q?.trim();
  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.ProductReviewWhereInput = {
    ...(filters.moderationStatus ? { moderationStatus: filters.moderationStatus } : {}),
    ...(filters.rating ? { rating: filters.rating } : {}),
    ...(filters.verifiedPurchase !== undefined
      ? { verifiedPurchase: filters.verifiedPurchase }
      : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(q
      ? {
          OR: [
            { comment: { contains: q, mode: "insensitive" } },
            { manualCustomerName: { contains: q, mode: "insensitive" } },
            { product: { name: { contains: q, mode: "insensitive" } } },
            { customer: { firstName: { contains: q, mode: "insensitive" } } },
            { customer: { lastName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.productReview.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, primaryImageUrl: true } },
        customer: { select: { id: true, firstName: true, lastName: true } },
        orderItem: {
          select: { id: true, sellerOrder: { select: { id: true, orderNumber: true } } },
        },
      },
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.productReview.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type ModerationDecision = "APPROVE" | "REJECT" | "HIDE";
type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Approve/reject/hide — never a hard delete (unlike the old isApproved-
 * boolean model this replaces), so a moderation call always leaves an
 * audit trail: who (`moderatedByAdminId`), when (`moderatedAt`), and why
 * (`moderationNote`, optional). The original `comment` is never rewritten
 * by this or any other admin action — moderation only ever changes
 * *publication* state, never the customer's actual words.
 */
export async function moderateReview(
  reviewId: string,
  decision: ModerationDecision,
  adminId: string,
  note?: string,
): Promise<ActionResult> {
  const review = await prisma.productReview.findUnique({ where: { id: reviewId } });
  if (!review) return { ok: false, error: "Review not found." };

  const nextStatus: ReviewModerationStatus =
    decision === "APPROVE"
      ? ReviewModerationStatus.APPROVED
      : decision === "REJECT"
        ? ReviewModerationStatus.REJECTED
        : ReviewModerationStatus.HIDDEN;

  if (
    nextStatus === ReviewModerationStatus.APPROVED &&
    review.source === ReviewSource.MANUAL_OFFLINE &&
    !review.consentConfirmed
  ) {
    return {
      ok: false,
      error:
        "This manual entry can't be published without confirming the customer gave permission.",
    };
  }

  await prisma.productReview.update({
    where: { id: reviewId },
    data: {
      moderationStatus: nextStatus,
      moderatedByAdminId: adminId,
      moderatedAt: new Date(),
      moderationNote: note || null,
    },
  });
  await recomputeProductRating(review.productId);
  return { ok: true };
}

export type CreateManualReviewInput = {
  productId: string;
  customerDisplayName: string;
  rating: number;
  comment?: string;
  sourceReference?: string;
  consentConfirmed: boolean;
  /** Admin picks the initial publication state — still goes through the same moderation pipeline as a WEBSITE review, just starting here instead of always at PENDING. */
  moderationStatus: ReviewModerationStatus;
};
export type CreateManualReviewResult =
  { ok: true; reviewId: string } | { ok: false; error: string };

/**
 * Genuine feedback an admin collected outside the platform (call centre,
 * WhatsApp, ...) — never eligible for the "Verified Purchase" badge or
 * the verified-rating aggregate (verifiedPurchase is hard-coded false
 * here, not settable by the caller) since it isn't linked to and
 * validated against a real delivered order. Publishing (moderationStatus
 * APPROVED) requires consentConfirmed — "the customer gave permission" —
 * to already be true.
 */
export async function createManualReview(
  input: CreateManualReviewInput,
  adminId: string,
): Promise<CreateManualReviewResult> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "Rating must be a whole number from 1 to 5." };
  }
  const name = input.customerDisplayName.trim();
  if (!name) return { ok: false, error: "Customer display name is required." };
  if (input.moderationStatus === ReviewModerationStatus.APPROVED && !input.consentConfirmed) {
    return {
      ok: false,
      error: "Confirm the customer gave permission to publish before approving this entry.",
    };
  }

  const review = await prisma.productReview.create({
    data: {
      productId: input.productId,
      customerId: null,
      manualCustomerName: name,
      rating: input.rating,
      comment: input.comment ? sanitizeReviewText(input.comment) : null,
      sourceReference: input.sourceReference || null,
      consentConfirmed: input.consentConfirmed,
      source: ReviewSource.MANUAL_OFFLINE,
      moderationStatus: input.moderationStatus,
      verifiedPurchase: false,
      createdByAdminId: adminId,
      ...(input.moderationStatus !== ReviewModerationStatus.PENDING
        ? { moderatedByAdminId: adminId, moderatedAt: new Date() }
        : {}),
    },
  });
  await recomputeProductRating(input.productId);
  return { ok: true, reviewId: review.id };
}
