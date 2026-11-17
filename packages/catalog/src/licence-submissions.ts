import { prisma } from "@kisan4u/db";
import type { SellerLicenceAudience } from "@kisan4u/db";
import type { SellerLicenceSubmissionInput } from "@kisan4u/validators";
import { writeAuditLog } from "./audit";
import { notifyUser, notifyAllAdmins } from "./licence-notifications";
import { reconcileSellerLicenceSubmissionCompliance } from "./licence-compliance";

export type SubmissionActor = { id: string; isAdmin: boolean };
export type SubmissionResult = { ok: true; submissionId: string } | { ok: false; error: string };

export type CreateSubmissionInput = SellerLicenceSubmissionInput & {
  documentStorageKey: string;
  documentMimeType: string;
  documentSizeBytes: number;
};

async function insertSubmission(
  sellerId: string,
  input: CreateSubmissionInput,
  actor: SubmissionActor,
  previousRevisionId: string | null,
): Promise<SubmissionResult> {
  const requirement = await prisma.licenceRequirement.findUnique({
    where: { id: input.requirementId },
    include: { nextVersion: { select: { id: true } } },
  });
  if (!requirement || !requirement.isActive || requirement.nextVersion) {
    return {
      ok: false,
      error:
        "This licence requirement is no longer current. Refresh and select an active requirement.",
    };
  }

  if (requirement.sameLicenceForBothAudiences) {
    if (input.audience !== "BOTH")
      return {
        ok: false,
        error: "This requirement uses one common licence for Customer and Dealer.",
      };
  } else {
    if (input.audience === "BOTH")
      return { ok: false, error: "Submit separate licences for Customer and Dealer." };
    if (input.audience === "CUSTOMER" && !requirement.customerRequired)
      return { ok: false, error: "This requirement does not apply to Customer." };
    if (input.audience === "DEALER" && !requirement.dealerRequired)
      return { ok: false, error: "This requirement does not apply to Dealer." };
  }

  const needsCustomerStates =
    (input.audience === "CUSTOMER" || input.audience === "BOTH") &&
    requirement.customerGeoType === "STATE_WISE";
  const needsDealerStates =
    (input.audience === "DEALER" || input.audience === "BOTH") &&
    requirement.dealerGeoType === "STATE_WISE";
  // A state-wise licence covers exactly one state per submission (spec:
  // "if a seller has the same licence for multiple states, they must
  // create a separate licence submission for each state") — enforced here
  // regardless of what the client sent, since a manually-modified request
  // payload must never be able to smuggle in more than one.
  if (needsCustomerStates && input.customerStateIds.length !== 1)
    return { ok: false, error: "Select exactly one state for Customer coverage." };
  if (needsDealerStates && input.dealerStateIds.length !== 1)
    return { ok: false, error: "Select exactly one state for Dealer coverage." };
  if (!needsCustomerStates && input.customerStateIds.length > 0)
    return {
      ok: false,
      error: "Customer coverage for this requirement is Pan India — no state should be submitted.",
    };
  if (!needsDealerStates && input.dealerStateIds.length > 0)
    return {
      ok: false,
      error: "Dealer coverage for this requirement is Pan India — no state should be submitted.",
    };

  // Never trust client-submitted state ids — re-validate against active IndianState rows.
  const allStateIds = [
    ...new Set([
      ...(needsCustomerStates ? input.customerStateIds : []),
      ...(needsDealerStates ? input.dealerStateIds : []),
    ]),
  ];
  if (allStateIds.length > 0) {
    const validCount = await prisma.indianState.count({
      where: { id: { in: allStateIds }, isActive: true },
    });
    if (validCount !== allStateIds.length)
      return { ok: false, error: "One or more selected states is invalid." };
  }

  if (previousRevisionId) {
    const previous = await prisma.sellerLicenceSubmission.findUnique({
      where: { id: previousRevisionId },
      select: { sellerId: true, status: true, nextRevision: { select: { id: true } } },
    });
    if (!previous || previous.sellerId !== sellerId)
      return { ok: false, error: "Original submission not found." };
    if (previous.nextRevision)
      return { ok: false, error: "This submission has already been resubmitted." };
    if (previous.status === "PENDING_APPROVAL")
      return { ok: false, error: "This submission is still pending review." };
  }

  const created = await prisma.sellerLicenceSubmission.create({
    data: {
      sellerId,
      requirementId: requirement.id,
      audience: input.audience,
      licenceNumber: input.licenceNumber,
      expiryDate: input.expiryDate,
      documentStorageKey: input.documentStorageKey,
      documentMimeType: input.documentMimeType,
      documentSizeBytes: input.documentSizeBytes,
      submittedById: actor.id,
      createdByAdmin: actor.isAdmin,
      previousRevisionId,
      ...(needsCustomerStates
        ? { customerStates: { connect: input.customerStateIds.map((id) => ({ id })) } }
        : {}),
      ...(needsDealerStates
        ? { dealerStates: { connect: input.dealerStateIds.map((id) => ({ id })) } }
        : {}),
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.isAdmin ? "ADMIN" : "SELLER",
    action: previousRevisionId ? "LICENCE_SUBMISSION_RESUBMITTED" : "LICENCE_SUBMISSION_CREATED",
    entityType: "SellerLicenceSubmission",
    entityId: created.id,
    metadata: {
      requirementId: requirement.id,
      audience: input.audience,
      createdByAdmin: actor.isAdmin,
      previousRevisionId,
    },
  });

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { userId: true },
  });
  if (seller) {
    await notifyUser({
      userId: seller.userId,
      title: "Licence submission received",
      body: `Your "${requirement.name}" licence submission is pending review.`,
    });
  }
  await notifyAllAdmins({
    title: previousRevisionId ? "Licence resubmission" : "New licence submission",
    body: `A "${requirement.name}" licence submission needs review.`,
  });

  return { ok: true, submissionId: created.id };
}

export async function createSellerLicenceSubmission(
  sellerId: string,
  input: CreateSubmissionInput,
  actor: SubmissionActor,
): Promise<SubmissionResult> {
  return insertSubmission(sellerId, input, actor, null);
}

/** Covers every "edit and resubmit" path in spec §7's table: rejected -> edit+resubmit, expired -> renewal, approved -> proactive renewal before expiry. Revoked is intentionally excluded here — revocation is a compliance action an admin must explicitly re-open (see spec §7 "Revoked: view reason and submit a replacement if permitted"), left as a future admin-mediated path rather than a bare self-serve resubmit. */
export async function resubmitSellerLicenceSubmission(
  sellerId: string,
  previousSubmissionId: string,
  input: CreateSubmissionInput,
  actor: SubmissionActor,
): Promise<SubmissionResult> {
  return insertSubmission(sellerId, input, actor, previousSubmissionId);
}

export type LicenceDecisionAction = "APPROVE" | "REJECT" | "REVOKE";

export async function decideSellerLicenceSubmission(
  submissionId: string,
  decision: { action: LicenceDecisionAction; reason?: string },
  actor: { id: string },
): Promise<SubmissionResult> {
  const submission = await prisma.sellerLicenceSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      sellerId: true,
      requirementId: true,
      requirement: { select: { name: true } },
      seller: { select: { userId: true } },
    },
  });
  if (!submission) return { ok: false, error: "Submission not found." };

  if (decision.action === "APPROVE" && submission.status !== "PENDING_APPROVAL") {
    return { ok: false, error: "Only a pending submission can be approved." };
  }
  if (decision.action === "REJECT") {
    if (submission.status !== "PENDING_APPROVAL")
      return { ok: false, error: "Only a pending submission can be rejected." };
    if (!decision.reason?.trim()) return { ok: false, error: "A rejection reason is required." };
  }
  if (decision.action === "REVOKE") {
    if (submission.status !== "APPROVED")
      return { ok: false, error: "Only an approved licence can be revoked." };
    if (!decision.reason?.trim()) return { ok: false, error: "A revocation reason is required." };
  }

  const nextStatus =
    decision.action === "APPROVE"
      ? "APPROVED"
      : decision.action === "REJECT"
        ? "REJECTED"
        : "REVOKED";
  await prisma.sellerLicenceSubmission.update({
    where: { id: submissionId },
    data: {
      status: nextStatus,
      reviewedById: actor.id,
      reviewedAt: new Date(),
      rejectionReason: decision.action === "REJECT" ? decision.reason : null,
      revocationReason: decision.action === "REVOKE" ? decision.reason : null,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: `LICENCE_SUBMISSION_${decision.action}D`,
    entityType: "SellerLicenceSubmission",
    entityId: submissionId,
    metadata: { requirementId: submission.requirementId },
    reason: decision.reason,
  });

  if (submission.seller) {
    const title =
      decision.action === "APPROVE"
        ? "Licence approved"
        : decision.action === "REJECT"
          ? "Licence rejected"
          : "Licence revoked";
    const body =
      decision.action === "APPROVE"
        ? `Your "${submission.requirement.name}" licence has been approved.`
        : `Your "${submission.requirement.name}" licence was ${decision.action === "REJECT" ? "rejected" : "revoked"}: ${decision.reason}`;
    await notifyUser({ userId: submission.seller.userId, title, body });
  }

  if (decision.action === "APPROVE") {
    // Bidirectional reconcile now handles both restoring the affected
    // audience(s) (customerVisible/dealerVisible + clamped states) AND
    // resolving every OPEN compliance review for this product+audience —
    // this used to only resolve reviews without ever actually restoring
    // product visibility, which was the root cause of approved licences
    // never making products reachable again. See licence-compliance.ts's
    // reconcileProductLicenceCompliance doc comment.
    await reconcileSellerLicenceSubmissionCompliance(submissionId, "REQUIREMENT_CHANGED");
  } else {
    await reconcileSellerLicenceSubmissionCompliance(
      submissionId,
      decision.action === "REJECT" ? "LICENCE_REJECTED" : "LICENCE_REVOKED",
    );
  }

  return { ok: true, submissionId };
}

/** Spec §9 "Edit allowed fields" — admin correction of licence number/expiry only; never silently touches the applicant's document, status, or decision fields. Always audited with before/after values. */
export async function adminEditSellerLicenceSubmission(
  submissionId: string,
  changes: { licenceNumber?: string; expiryDate?: Date },
  actor: { id: string },
): Promise<SubmissionResult> {
  const current = await prisma.sellerLicenceSubmission.findUnique({
    where: { id: submissionId },
    select: { licenceNumber: true, expiryDate: true },
  });
  if (!current) return { ok: false, error: "Submission not found." };

  await prisma.sellerLicenceSubmission.update({
    where: { id: submissionId },
    data: {
      licenceNumber: changes.licenceNumber ?? undefined,
      expiryDate: changes.expiryDate ?? undefined,
    },
  });
  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "LICENCE_SUBMISSION_EDITED",
    entityType: "SellerLicenceSubmission",
    entityId: submissionId,
    metadata: { before: current, after: changes },
  });
  return { ok: true, submissionId };
}

/**
 * Admin-only, hard delete — only ever permitted for a submission that is
 * already REJECTED, EXPIRED, or REVOKED. Those three statuses already
 * evaluate identically to "no submission at all" (MISSING) in
 * buildSellerLicenceEligibilityIndex's resolveLeg, so removing the row
 * changes nothing about eligibility and no reconcile call is needed —
 * deleting a currently PENDING_APPROVAL or APPROVED submission is refused
 * because that WOULD change eligibility, and must go through Reject/Revoke
 * first (which already reconciles correctly and keeps a reason on record).
 * ProductComplianceReview.submissionId and the self-referencing
 * previousRevisionId FK both use ON DELETE SET NULL, so this never fails
 * on a dangling reference — it just detaches, preserving the surviving
 * rows' own history.
 */
export async function deleteSellerLicenceSubmission(
  submissionId: string,
  actor: { id: string },
): Promise<SubmissionResult> {
  const submission = await prisma.sellerLicenceSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      requirementId: true,
      sellerId: true,
      licenceNumber: true,
      requirement: { select: { name: true } },
    },
  });
  if (!submission) return { ok: false, error: "Submission not found." };
  if (submission.status === "PENDING_APPROVAL" || submission.status === "APPROVED") {
    return {
      ok: false,
      error:
        "Only a rejected, expired, or revoked licence can be deleted. Reject or revoke it first.",
    };
  }

  await prisma.sellerLicenceSubmission.delete({ where: { id: submissionId } });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "LICENCE_SUBMISSION_DELETED",
    entityType: "SellerLicenceSubmission",
    entityId: submissionId,
    metadata: {
      requirementId: submission.requirementId,
      requirementName: submission.requirement.name,
      sellerId: submission.sellerId,
      licenceNumber: submission.licenceNumber,
      statusAtDeletion: submission.status,
    },
  });

  return { ok: true, submissionId };
}

export type { SellerLicenceAudience };
