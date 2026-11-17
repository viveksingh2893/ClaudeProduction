"use server";

import { getLicenceSubmissionById } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { requireSession } from "./session-guard";

export type LicenceSubmissionDetail = {
  id: string;
  requirementName: string;
  sellerShopName: string;
  audience: "CUSTOMER" | "DEALER" | "BOTH";
  customerGeoType: "PAN_INDIA" | "STATE_WISE" | null;
  dealerGeoType: "PAN_INDIA" | "STATE_WISE" | null;
  customerStates: string[];
  dealerStates: string[];
  licenceNumber: string;
  expiryDate: string;
  submittedAt: string;
  reviewedAt: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  rejectionReason: string | null;
  revocationReason: string | null;
  documentMimeType: string;
  revisionChain: { id: string; submittedAt: string; status: string; isCurrent: boolean }[];
};

export type LicenceDetailActionResult =
  { ok: true; data: LicenceSubmissionDetail } | { ok: false; error: string };

/** Shared by both the seller's own licence table and the admin Seller Licences table — a seller may only view their own submission, an admin may view any. */
export async function getLicenceSubmissionDetailAction(
  submissionId: string,
): Promise<LicenceDetailActionResult> {
  const session = await requireSession(["ADMIN", "SELLER"]);
  const submission = await getLicenceSubmissionById(submissionId);
  if (!submission) return { ok: false, error: "Licence submission not found." };
  if (session.user.role === "SELLER") {
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!sellerProfile || sellerProfile.id !== submission.sellerId) {
      return { ok: false, error: "Licence submission not found." };
    }
  }

  // Walk the full revision chain (oldest -> newest) for the "View history" action.
  type ChainLink = { id: string; submittedAt: string; status: string; isCurrent: boolean };
  type PrevRow = {
    id: string;
    submittedAt: Date;
    status: string;
    previousRevision: { id: string } | null;
  };
  const chain: ChainLink[] = [
    {
      id: submission.id,
      submittedAt: submission.submittedAt.toISOString(),
      status: submission.status,
      isCurrent: true,
    },
  ];
  let previousRevisionId: string | null = submission.previousRevision?.id ?? null;
  while (previousRevisionId) {
    const prev: PrevRow | null = await prisma.sellerLicenceSubmission.findUnique({
      where: { id: previousRevisionId },
      select: {
        id: true,
        submittedAt: true,
        status: true,
        previousRevision: { select: { id: true } },
      },
    });
    if (!prev) break;
    chain.unshift({
      id: prev.id,
      submittedAt: prev.submittedAt.toISOString(),
      status: prev.status,
      isCurrent: false,
    });
    previousRevisionId = prev.previousRevision?.id ?? null;
  }

  return {
    ok: true,
    data: {
      id: submission.id,
      requirementName: submission.requirement.name,
      sellerShopName: submission.seller.shopName,
      audience: submission.audience,
      customerGeoType: submission.requirement.customerGeoType,
      dealerGeoType: submission.requirement.dealerGeoType,
      customerStates: submission.customerStates.map((s) => s.name),
      dealerStates: submission.dealerStates.map((s) => s.name),
      licenceNumber: submission.licenceNumber,
      expiryDate: submission.expiryDate.toISOString(),
      submittedAt: submission.submittedAt.toISOString(),
      reviewedAt: submission.reviewedAt?.toISOString() ?? null,
      status: submission.status,
      rejectionReason: submission.rejectionReason,
      revocationReason: submission.revocationReason,
      documentMimeType: submission.documentMimeType,
      revisionChain: chain,
    },
  };
}
