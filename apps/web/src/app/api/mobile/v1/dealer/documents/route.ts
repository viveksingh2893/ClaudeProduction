import { NextRequest } from "next/server";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * Authenticated dealer-KYC document upload for the mobile "Become a
 * Dealer" form (the app mirror of apps/web/src/app/register/dealer/
 * upload-document, which is gated by the signed-out onboarding cookie and
 * so can't be reused by a logged-in customer). multipart/form-data, one
 * `file` field. Returns a /api/uploads/dealer-documents/... URL — the
 * exact shape dealerApplicationSchema's gstDocUrl/licenseDocUrl accept —
 * which the client echoes back on submit.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    await requireMobileAuth(req);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonError(400, "NO_FILE", "No file provided.");
    }
    const validation = await validatePrivateDocumentContent(file);
    if (validation === "FILE_TOO_LARGE") {
      return jsonError(400, "TOO_LARGE", "File is larger than 5 MB.");
    }
    if (validation) {
      return jsonError(400, validation === "CONTENT_MISMATCH" ? "CONTENT_MISMATCH" : "BAD_TYPE", validation === "CONTENT_MISMATCH" ? "File content doesn't match its extension." : validation === "UNSAFE_PDF" ? "PDFs containing scripts or automatic actions aren't allowed." : "Only PDF, JPG, PNG or WEBP files are allowed.");
    }

    const uploaded = await uploadPrivateDocument(file, "dealer-documents");
    return jsonOk({ url: uploaded.storageKey });
  });
}
