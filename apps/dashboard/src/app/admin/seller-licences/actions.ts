"use server";

import { revalidatePath } from "next/cache";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import {
  decideSellerLicenceSubmission,
  adminEditSellerLicenceSubmission,
  deleteSellerLicenceSubmission,
  createSellerLicenceSubmission,
  getActiveRequirementsForTaxonomyNode,
  getSellerCurrentLicenceSubmissions,
  getTaxonomyPathLabelsForSubmissions,
} from "@kisan4u/catalog";
import { sellerLicenceSubmissionInputSchema, licenceDecisionSchema } from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function decideSellerLicenceSubmissionAction(input: {
  submissionId: string;
  action: "APPROVE" | "REJECT" | "REVOKE";
  reason?: string;
}): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const parsed = licenceDecisionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await decideSellerLicenceSubmission(
    parsed.data.submissionId,
    { action: parsed.data.action, reason: parsed.data.reason },
    { id: session.user.id },
  );
  if (!result.ok) return result;
  revalidatePath("/admin/seller-licences");
  return { ok: true };
}

export async function adminEditSellerLicenceSubmissionAction(
  submissionId: string,
  changes: { licenceNumber?: string; expiryDate?: string },
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await adminEditSellerLicenceSubmission(
    submissionId,
    {
      licenceNumber: changes.licenceNumber,
      expiryDate: changes.expiryDate ? new Date(changes.expiryDate) : undefined,
    },
    { id: session.user.id },
  );
  if (!result.ok) return result;
  revalidatePath("/admin/seller-licences");
  return { ok: true };
}

export async function adminDeleteSellerLicenceSubmissionAction(
  submissionId: string,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await deleteSellerLicenceSubmission(submissionId, { id: session.user.id });
  if (!result.ok) return result;
  revalidatePath("/admin/seller-licences");
  return { ok: true };
}

export async function getActiveRequirementsForNodeAdminAction(
  nodeType: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY",
  nodeId: string,
) {
  await requireSession(["ADMIN"]);
  const data = await getActiveRequirementsForTaxonomyNode(nodeType, nodeId);
  return { ok: true as const, data };
}

export async function adminCreateSellerLicenceSubmissionAction(
  formData: FormData,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const sellerId = String(formData.get("sellerId") ?? "");
  if (!sellerId) return { ok: false, error: "Select a seller." };

  const raw = {
    requirementId: String(formData.get("requirementId") ?? ""),
    audience: String(formData.get("audience") ?? "") as "CUSTOMER" | "DEALER" | "BOTH",
    licenceNumber: String(formData.get("licenceNumber") ?? ""),
    expiryDate: String(formData.get("expiryDate") ?? ""),
    customerStateIds: formData.getAll("customerStateIds").map(String),
    dealerStateIds: formData.getAll("dealerStateIds").map(String),
  };
  const parsed = sellerLicenceSubmissionInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const file = formData.get("document") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "Upload a licence document." };
  const validationError = await validatePrivateDocumentContent(file);
  if (validationError === "FILE_TOO_LARGE")
    return { ok: false, error: "The document must be 5MB or smaller." };
  if (validationError === "UNSUPPORTED_TYPE")
    return { ok: false, error: "Only PDF, JPEG, PNG, or WEBP documents are allowed." };
  if (validationError === "CONTENT_MISMATCH")
    return { ok: false, error: "File content doesn't match its extension." };
  if (validationError === "UNSAFE_PDF")
    return { ok: false, error: "PDFs containing scripts or automatic actions aren't allowed." };
  const uploaded = await uploadPrivateDocument(
    file,
    `seller-selling-licences/${sellerId}/${parsed.data.requirementId}`,
  );

  const result = await createSellerLicenceSubmission(
    sellerId,
    {
      ...parsed.data,
      documentStorageKey: uploaded.storageKey,
      documentMimeType: uploaded.mimeType,
      documentSizeBytes: uploaded.sizeBytes,
    },
    { id: session.user.id, isAdmin: true },
  );
  if (!result.ok) return result;

  const autoApprove = formData.get("autoApprove") === "true";
  if (autoApprove) {
    const approveResult = await decideSellerLicenceSubmission(
      result.submissionId,
      { action: "APPROVE" },
      { id: session.user.id },
    );
    if (!approveResult.ok) return approveResult;
  }

  revalidatePath("/admin/seller-licences");
  return { ok: true };
}

/**
 * Licences for one seller, fetched only when that seller's row is
 * expanded in the grouped admin table — keeps the page's initial load to
 * just the seller summaries (see getAdminLicenceSellerSummaries), not
 * every licence for every seller on the page. Returns the same
 * `AdminLicenceRow` shape the table's Edit/Decision/Delete/detail modals
 * already expect (see seller-licences-table.tsx), just sourced per-seller
 * instead of from a flat paginated query.
 */
export async function getSellerLicenceRowsForAdminAction(sellerId: string) {
  await requireSession(["ADMIN"]);
  const rows = await getSellerCurrentLicenceSubmissions(sellerId);
  const pathLabels = await getTaxonomyPathLabelsForSubmissions(rows);

  return {
    ok: true as const,
    data: rows.map((r) => ({
      id: r.id,
      sellerId: r.sellerId,
      sellerName: r.seller.shopName,
      sellerContactName:
        [r.seller.user.firstName, r.seller.user.lastName].filter(Boolean).join(" ") || "—",
      sellerContactEmail: r.seller.user.email,
      requirementName: r.requirement.name,
      taxonomyPathLabel:
        pathLabels.get(`${r.requirement.taxonomyNodeType}:${r.requirement.taxonomyNodeId}`) ?? "—",
      audience: r.audience,
      customerStates: r.customerStates.map((s) => s.name),
      dealerStates: r.dealerStates.map((s) => s.name),
      customerGeoType: r.requirement.customerGeoType,
      dealerGeoType: r.requirement.dealerGeoType,
      licenceNumber: r.licenceNumber,
      expiryDate: r.expiryDate.toISOString(),
      submittedAt: r.submittedAt.toISOString(),
      status: r.status,
      rejectionReason: r.rejectionReason,
      revocationReason: r.revocationReason,
      createdByAdmin: r.createdByAdmin,
    })),
  };
}
