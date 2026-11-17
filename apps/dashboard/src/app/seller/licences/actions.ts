"use server";

import { revalidatePath } from "next/cache";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import { createSellerLicenceSubmission, resubmitSellerLicenceSubmission } from "@kisan4u/catalog";
import { sellerLicenceSubmissionInputSchema } from "@kisan4u/validators";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

type Result = { ok: true; submissionId: string } | { ok: false; error: string };

function parseFormInput(formData: FormData) {
  return {
    requirementId: String(formData.get("requirementId") ?? ""),
    audience: String(formData.get("audience") ?? "") as "CUSTOMER" | "DEALER" | "BOTH",
    licenceNumber: String(formData.get("licenceNumber") ?? ""),
    expiryDate: String(formData.get("expiryDate") ?? ""),
    customerStateIds: formData.getAll("customerStateIds").map(String),
    dealerStateIds: formData.getAll("dealerStateIds").map(String),
  };
}

async function uploadDocument(
  file: File | null,
  sellerId: string,
  requirementId: string,
): Promise<
  | { ok: true; storageKey: string; mimeType: string; sizeBytes: number }
  | { ok: false; error: string }
> {
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
    `seller-selling-licences/${sellerId}/${requirementId}`,
  );
  return { ok: true, ...uploaded };
}

export async function createSellerLicenceSubmissionAction(formData: FormData): Promise<Result> {
  const { sellerProfileId, session } = await requireApprovedSeller();
  const raw = parseFormInput(formData);
  const parsed = sellerLicenceSubmissionInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const upload = await uploadDocument(
    formData.get("document") as File | null,
    sellerProfileId,
    parsed.data.requirementId,
  );
  if (!upload.ok) return upload;

  const result = await createSellerLicenceSubmission(
    sellerProfileId,
    {
      ...parsed.data,
      documentStorageKey: upload.storageKey,
      documentMimeType: upload.mimeType,
      documentSizeBytes: upload.sizeBytes,
    },
    { id: session.user.id, isAdmin: false },
  );
  if (!result.ok) return result;
  revalidatePath("/seller/licences");
  return { ok: true, submissionId: result.submissionId };
}

export async function resubmitSellerLicenceSubmissionAction(
  previousSubmissionId: string,
  formData: FormData,
): Promise<Result> {
  const { sellerProfileId, session } = await requireApprovedSeller();
  const raw = parseFormInput(formData);
  const parsed = sellerLicenceSubmissionInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const upload = await uploadDocument(
    formData.get("document") as File | null,
    sellerProfileId,
    parsed.data.requirementId,
  );
  if (!upload.ok) return upload;

  const result = await resubmitSellerLicenceSubmission(
    sellerProfileId,
    previousSubmissionId,
    {
      ...parsed.data,
      documentStorageKey: upload.storageKey,
      documentMimeType: upload.mimeType,
      documentSizeBytes: upload.sizeBytes,
    },
    { id: session.user.id, isAdmin: false },
  );
  if (!result.ok) return result;
  revalidatePath("/seller/licences");
  return { ok: true, submissionId: result.submissionId };
}
