import { NextRequest } from "next/server";
import { getVerifiedPhoneForOnboardingSession, recordDealerOnboardingUpload } from "@kisan4u/auth";
import {
  deletePrivateDocument,
  uploadPrivateDocument,
  validatePrivateDocumentContent,
} from "@kisan4u/providers";
import { jsonError, jsonOk, withMobileApi } from "@/lib/mobile-api";

/**
 * Dealer-KYC document upload for the SIGNED-OUT mobile "Register as a
 * Dealer" flow. The user has no account/token yet, so this is gated by
 * the OTP-verified onboarding ticket (`onboardingSessionId`, sent as a
 * form field) instead of a bearer token — the app mirror of apps/web's
 * cookie-scoped /register/dealer/upload-document. Returns a
 * /api/uploads/dealer-documents/... URL to echo back as
 * gstDocUrl / licenseDocUrl on submit.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const formData = await req.formData();
    const sessionId = formData.get("onboardingSessionId");
    if (typeof sessionId !== "string" || !(await getVerifiedPhoneForOnboardingSession(sessionId))) {
      return jsonError(
        401,
        "SESSION_EXPIRED",
        "Your verification session has expired. Please start again.",
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError(400, "NO_FILE", "No file provided.");
    const validation = await validatePrivateDocumentContent(file);
    if (validation === "FILE_TOO_LARGE")
      return jsonError(400, "TOO_LARGE", "File is larger than 5 MB.");
    if (validation) {
      return jsonError(
        400,
        validation === "CONTENT_MISMATCH" ? "CONTENT_MISMATCH" : "BAD_TYPE",
        validation === "CONTENT_MISMATCH"
          ? "File content doesn't match its extension."
          : validation === "UNSAFE_PDF"
            ? "PDFs containing scripts or automatic actions aren't allowed."
            : "Only PDF, JPG, PNG or WEBP files are allowed.",
      );
    }

    const uploaded = await uploadPrivateDocument(file, "dealer-documents");
    try {
      await recordDealerOnboardingUpload(sessionId, uploaded.storageKey);
    } catch (error) {
      await deletePrivateDocument(uploaded.storageKey);
      throw error;
    }
    return jsonOk({ url: uploaded.storageKey });
  });
}
