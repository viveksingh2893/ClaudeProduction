import { prisma } from "@kisan4u/db";
import type { ComplianceReviewReason, TaxonomyNodeType } from "@kisan4u/db";
import {
  buildSellerLicenceEligibilityIndex,
  evaluateEligibilityForPath,
} from "./licence-eligibility";
import { notifyUser, notifyAllAdmins } from "./licence-notifications";

function productWhereForNode(nodeType: TaxonomyNodeType, nodeId: string) {
  if (nodeType === "CATEGORY") return { categoryId: nodeId };
  if (nodeType === "SUBCATEGORY") return { subCategoryId: nodeId };
  return { subSubCategoryId: nodeId };
}

/**
 * The single place that turns "eligibility changed" into an actual product
 * restriction OR restoration — spec §8/§10/§11: never disables the whole
 * product, only the audience/state combinations that are no longer
 * compliant; everything still compliant stays exactly as configured. Always
 * re-derives eligibility fresh (never trusts a cached/prior result), so
 * it's safe to call redundantly from multiple triggers (requirement change,
 * submission approved/rejected/expired/revoked, expiry sweep) without
 * double-restricting or double-restoring.
 *
 * Bidirectional by design — this used to only ever narrow, which was the
 * root cause of two related bugs: (1) "approved licences don't make
 * products visible again" — an audience fully blocked via
 * customerVisible/dealerVisible=false had no path back to true; (2) a
 * still-visible-but-partially-restricted audience (a non-empty states
 * subset) could shrink but never grow again, so a LATER licence-submission
 * approval that genuinely widened eligibility (e.g. a second state approved
 * for the same requirement) silently never reached the product — it stayed
 * stuck at whatever the first narrowing had set.
 *
 * Both cases are now restored the same way: a FULLY blocked audience
 * (visible=false) restores to the seller's own previously-configured
 * states, clamped to what's newly eligible. A PARTIALLY restricted audience
 * (visible=true, non-empty states subset) only re-syncs to the fresh
 * eligible set when an OPEN ProductComplianceReview exists for that
 * product+audience — proof the current list was imposed by an earlier run
 * of this same function, never by the seller's own product-form save
 * (which never creates one). Without an open review, a partial list is
 * assumed to be the seller's own deliberate choice and is still only ever
 * narrowed, never silently widened — the seller can always widen it further
 * themselves via the product form's "Select wherever applicable".
 */
async function reconcileProductLicenceCompliance(
  productId: string,
  reason: ComplianceReviewReason,
  context: { requirementId?: string | null; submissionId?: string | null },
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sellerId: true,
      name: true,
      categoryId: true,
      subCategoryId: true,
      subSubCategoryId: true,
      customerVisible: true,
      dealerVisible: true,
      customerAvailableStates: { select: { id: true } },
      dealerAvailableStates: { select: { id: true } },
    },
  });
  if (!product || !product.sellerId) return;

  const index = await buildSellerLicenceEligibilityIndex(product.sellerId);
  const eligibility = evaluateEligibilityForPath(index, {
    categoryId: product.categoryId,
    subCategoryId: product.subCategoryId,
    subSubCategoryId: product.subSubCategoryId,
  });

  // An OPEN review for this product+audience only ever exists because a
  // PAST run of this same function narrowed it (see the restrictedAudiences
  // loop below) — the seller's own product-form save path never creates
  // one. So its presence is an unambiguous "this leg's current states list
  // is system-imposed, not the seller's deliberate choice" marker, reused
  // here (rather than adding new schema) to fix the stale-cache bug where a
  // LATER licence-submission approval that widens eligibility never
  // widened an already-visible, already-partially-restricted product back
  // out (e.g. a seller's O-Form approved for Maharashtra first locked every
  // Crop Nutrients product to Maharashtra-only, and three more states
  // approved afterward for the same requirement never got added).
  const openReviews = await prisma.productComplianceReview.findMany({
    where: { productId, status: "OPEN" },
    select: { affectedAudience: true },
    distinct: ["affectedAudience"],
  });
  const openReviewAudiences = new Set(openReviews.map((r) => r.affectedAudience));

  const legs = [
    {
      key: "customer" as const,
      audience: "CUSTOMER" as const,
      configuredIds: product.customerAvailableStates.map((s) => s.id),
      currentlyVisible: product.customerVisible,
    },
    {
      key: "dealer" as const,
      audience: "DEALER" as const,
      configuredIds: product.dealerAvailableStates.map((s) => s.id),
      currentlyVisible: product.dealerVisible,
    },
  ];

  // customerAvailableStates/dealerAvailableStates use "empty list = Pan
  // India" as their convention (see product-submission.ts) — an empty
  // list can NEVER also be made to mean "blocked in every state," or
  // every other reader (isProductAvailableForState, catalogue queries)
  // would misread a fully-blocked product as nationwide-available. A
  // total block is therefore expressed with the pre-existing, unambiguous
  // customerVisible/dealerVisible flags instead — reusing the exact
  // audience-visibility mechanism line-validation.ts's WRONG_AUDIENCE
  // check and the customer/dealer catalogue queries already respect.
  const updates: Record<string, unknown> = {};
  const restrictedAudiences: ("CUSTOMER" | "DEALER")[] = [];
  const restoredAudiences: ("CUSTOMER" | "DEALER")[] = [];

  for (const leg of legs) {
    const eligibleIds = eligibility[leg.key].eligibleStateIds;
    const visibleField = leg.key === "customer" ? "customerVisible" : "dealerVisible";
    const statesField =
      leg.key === "customer" ? "customerAvailableStates" : "dealerAvailableStates";

    if (eligibleIds.length === 0) {
      // Fully non-compliant — restrict, but only if not already restricted.
      if (leg.currentlyVisible) {
        updates[visibleField] = false;
        restrictedAudiences.push(leg.audience);
      }
      continue;
    }

    if (!leg.currentlyVisible) {
      // Was fully blocked, now has at least one eligible state — restore.
      // configuredIds was never touched while blocked (see doc comment
      // above), so it still holds exactly what the seller had selected
      // before the block; clamp it to what's newly eligible rather than
      // trusting it verbatim (a state that was eligible when blocked may
      // no longer be, even as others are newly eligible again).
      //
      // Critical: an empty states list means "Pan India" everywhere else
      // in the app (isProductAvailableForState, catalogue queries) — so
      // it must ONLY be left/restored empty when the audience is
      // genuinely Pan-India-eligible now. If eligibility is only partial
      // (specific states), the states list must always end up as that
      // concrete, non-empty list — including when configuredIds was
      // itself empty (nothing meaningful was ever configured while
      // blocked), where leaving it empty would silently and incorrectly
      // read as nationwide availability.
      const legIsPanIndia = eligibility[leg.key].isPanIndia;
      updates[visibleField] = true;
      if (legIsPanIndia) {
        const restoredIds = leg.configuredIds.filter((id) => eligibleIds.includes(id));
        if (leg.configuredIds.length > 0 && restoredIds.length !== leg.configuredIds.length) {
          updates[statesField] = { set: restoredIds.map((id) => ({ id })) };
        }
      } else {
        const restoredIds =
          leg.configuredIds.length > 0
            ? leg.configuredIds.filter((id) => eligibleIds.includes(id))
            : eligibleIds;
        updates[statesField] = { set: restoredIds.map((id) => ({ id })) };
      }
      restoredAudiences.push(leg.audience);
      continue;
    }

    // Already visible. Nationwide (empty configuredIds) always re-syncs to
    // the fresh eligible set, same as before. A non-empty configuredIds
    // only re-syncs to the fresh eligible set when an OPEN review says this
    // leg's current list is system-imposed (see doc comment above) — the
    // seller's own deliberate narrower choice (no open review) still only
    // ever gets narrowed, never silently widened.
    const wasNationwide = leg.configuredIds.length === 0;
    const systemOwned = openReviewAudiences.has(leg.audience);
    const newAllowedIds =
      wasNationwide || systemOwned
        ? eligibleIds
        : leg.configuredIds.filter((id) => eligibleIds.includes(id));

    // Nationwide's effective "previous" set is every active state, not the
    // literal empty list — comparing against the empty list directly would
    // misclassify the classic "was Pan India, now restricted to a
    // state-wise licence" case as a widen (nothing to compare against) with
    // the wrong bucket/notification, instead of the restriction it is.
    const previousIds = wasNationwide ? index.activeStateIds : leg.configuredIds;
    const removedAny = previousIds.some((id) => !newAllowedIds.includes(id));
    const addedAny = newAllowedIds.some((id) => !previousIds.includes(id));
    if (!removedAny && !addedAny) continue;

    updates[statesField] = { set: newAllowedIds.map((id) => ({ id })) };
    if (addedAny) {
      // Coverage genuinely expanded (a later licence-submission approval
      // added a state) — resolve the stale OPEN review the earlier
      // narrowing left behind rather than leaving it open forever, exactly
      // like the full-block restoration path below.
      restoredAudiences.push(leg.audience);
    } else {
      restrictedAudiences.push(leg.audience);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: { ...updates, licenceComplianceCheckedAt: new Date() },
    });
    for (const audience of restrictedAudiences) {
      await tx.productComplianceReview.create({
        data: {
          productId: product.id,
          sellerId: product.sellerId!,
          requirementId: context.requirementId ?? null,
          submissionId: context.submissionId ?? null,
          reason,
          affectedAudience: audience,
          detail: `"${product.name}" was restricted for ${audience === "CUSTOMER" ? "Customer" : "Dealer"} in one or more states.`,
        },
      });
    }
    if (restoredAudiences.length > 0) {
      // Resolve every OPEN review for this product+audience combination —
      // not just ones tied to the specific requirement/submission that
      // triggered this call, since the product may have accumulated
      // reviews from more than one requirement over time and the audience
      // is, by construction, no longer blocked by any of them.
      await tx.productComplianceReview.updateMany({
        where: {
          productId: product.id,
          affectedAudience: { in: restoredAudiences },
          status: "OPEN",
        },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
    }
  });

  const seller =
    restrictedAudiences.length > 0 || restoredAudiences.length > 0
      ? await prisma.sellerProfile.findUnique({
          where: { id: product.sellerId },
          select: { userId: true },
        })
      : null;

  if (restrictedAudiences.length > 0) {
    if (seller) {
      await notifyUser({
        userId: seller.userId,
        title: "Product selling restricted",
        body: `"${product.name}" was automatically restricted for ${restrictedAudiences.map((a) => (a === "CUSTOMER" ? "Customer" : "Dealer")).join(" and ")} in one or more states because of a licence change. Open Selling Licences to review.`,
      });
    }
    await notifyAllAdmins({
      title: "Product sent for compliance review",
      body: `"${product.name}" needs compliance review after a licence change.`,
    });
  }
  if (restoredAudiences.length > 0 && seller) {
    await notifyUser({
      userId: seller.userId,
      title: "Product selling restored",
      body: `"${product.name}" is available again for ${restoredAudiences.map((a) => (a === "CUSTOMER" ? "Customer" : "Dealer")).join(" and ")} now that your licence covers it. Reopen the product to expand state availability further if you'd like.`,
    });
  }
}

/** Re-checks every product under a taxonomy node (and, for CATEGORY/SUBCATEGORY, every descendant) — call after a requirement is created, activated, or materially revised. */
export async function reconcileTaxonomyNodeCompliance(
  nodeType: TaxonomyNodeType,
  nodeId: string,
  reason: ComplianceReviewReason,
  requirementId: string,
): Promise<void> {
  const products = await prisma.product.findMany({
    where: { ...productWhereForNode(nodeType, nodeId), sellerId: { not: null } },
    select: { id: true },
  });
  for (const p of products) {
    await reconcileProductLicenceCompliance(p.id, reason, { requirementId });
  }
}

/** Re-checks every product this exact seller has under the taxonomy node the submission's requirement targets — call after a submission is rejected, revoked, or expires. */
export async function reconcileSellerLicenceSubmissionCompliance(
  submissionId: string,
  reason: ComplianceReviewReason,
): Promise<void> {
  const submission = await prisma.sellerLicenceSubmission.findUnique({
    where: { id: submissionId },
    select: {
      sellerId: true,
      requirementId: true,
      requirement: { select: { taxonomyNodeType: true, taxonomyNodeId: true } },
    },
  });
  if (!submission) return;
  const { taxonomyNodeType, taxonomyNodeId } = submission.requirement;
  const products = await prisma.product.findMany({
    where: {
      ...productWhereForNode(taxonomyNodeType, taxonomyNodeId),
      sellerId: submission.sellerId,
    },
    select: { id: true },
  });
  for (const p of products) {
    await reconcileProductLicenceCompliance(p.id, reason, {
      requirementId: submission.requirementId,
      submissionId,
    });
  }
}

/** Re-checks one specific product directly — call after its own taxonomy path or state configuration changes (product save/submit/approve). */
export async function reconcileSingleProductCompliance(productId: string): Promise<void> {
  await reconcileProductLicenceCompliance(productId, "REQUIREMENT_CHANGED", {});
}

/**
 * Lazy "promote on read" sweep — this codebase has no cron/queue
 * infrastructure anywhere (see packages/orders/src/settlement.ts's
 * promoteEligibleSettlements for the established precedent), so instead
 * of a scheduled job, this is called opportunistically whenever the
 * seller/admin licence list pages load. Eligibility itself never depends
 * on this having run yet — buildSellerLicenceEligibilityIndex already
 * treats a stale APPROVED-but-past-expiry row as EXPIRED purely by
 * comparing expiryDate at evaluation time — this only exists to make the
 * stored status/table filters and the compliance-review/notification side
 * effects catch up promptly.
 */
export async function sweepExpiredLicenceSubmissions(): Promise<number> {
  const now = new Date();
  const expired = await prisma.sellerLicenceSubmission.findMany({
    where: { status: "APPROVED", expiryDate: { lte: now }, nextRevision: { is: null } },
    select: {
      id: true,
      sellerId: true,
      requirement: { select: { name: true } },
      seller: { select: { userId: true } },
    },
  });
  for (const row of expired) {
    await prisma.sellerLicenceSubmission.update({
      where: { id: row.id },
      data: { status: "EXPIRED" },
    });
    await notifyUser({
      userId: row.seller.userId,
      title: "Licence expired",
      body: `Your "${row.requirement.name}" licence has expired. Submit a renewal to restore eligibility.`,
    });
    await reconcileSellerLicenceSubmissionCompliance(row.id, "LICENCE_EXPIRED");
  }
  return expired.length;
}

export type ComplianceReviewFilters = {
  status?: "OPEN" | "RESOLVED";
  page?: number;
  pageSize?: number;
};

/** Admin compliance-review queue — every ProductComplianceReview row, newest first. */
export async function getComplianceReviews(filters: ComplianceReviewFilters = {}) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const where = filters.status ? { status: filters.status } : {};
  const [rows, total] = await Promise.all([
    prisma.productComplianceReview.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, slug: true } },
        seller: { select: { id: true, shopName: true } },
        requirement: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.productComplianceReview.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function resolveComplianceReview(
  id: string,
  actor: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const review = await prisma.productComplianceReview.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!review) return { ok: false, error: "Compliance review not found." };
  if (review.status === "RESOLVED") return { ok: true };
  await prisma.productComplianceReview.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actor.id },
  });
  return { ok: true };
}

/**
 * DD/MM/YYYY, UTC-safe (never local-timezone-shifted) — duplicated from
 * packages/ui/src/date.ts's formatDateDDMMYYYY rather than imported,
 * since packages/catalog is a server-only package and packages/ui is
 * React/DOM-oriented; both must stay byte-identical in behavior (whole
 * calendar date, UTC parts only) even though they can't share a module
 * across that boundary.
 */
function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

const REMINDER_THRESHOLDS_DAYS = [30, 15, 7, 0];

/** Same lazy-sweep convention as sweepExpiredLicenceSubmissions — spec's suggested 30/15/7/0-day reminder cadence, deduplicated by checking for a prior reminder notification with the same submission+threshold marker rather than adding a new schema field to the generic Notification model. */
export async function sendLicenceExpiryReminders(): Promise<number> {
  const now = new Date();
  const maxWindowMs = 30 * 24 * 60 * 60 * 1000;
  const upcoming = await prisma.sellerLicenceSubmission.findMany({
    where: {
      status: "APPROVED",
      nextRevision: { is: null },
      expiryDate: { gte: now, lte: new Date(now.getTime() + maxWindowMs) },
    },
    select: {
      id: true,
      expiryDate: true,
      requirement: { select: { name: true } },
      seller: { select: { userId: true } },
    },
  });

  let sent = 0;
  for (const s of upcoming) {
    const daysLeft = Math.floor((s.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const threshold = REMINDER_THRESHOLDS_DAYS.find((t) => daysLeft === t);
    if (threshold === undefined) continue;

    const marker = `(ref:${s.id}:${threshold})`;
    const alreadySent = await prisma.notification.findFirst({
      where: { userId: s.seller.userId, body: { endsWith: marker } },
    });
    if (alreadySent) continue;

    const body =
      threshold === 0
        ? `Your "${s.requirement.name}" licence expires today — submit a renewal now to avoid a sales restriction. ${marker}`
        : `Your "${s.requirement.name}" licence expires in ${threshold} day${threshold === 1 ? "" : "s"} (on ${formatDateDDMMYYYY(s.expiryDate)}). Submit a renewal soon. ${marker}`;
    await notifyUser({ userId: s.seller.userId, title: "Licence expiring soon", body });
    sent++;
  }
  return sent;
}
