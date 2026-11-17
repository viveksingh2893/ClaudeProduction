import { NextRequest } from "next/server";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import { getBaProfileForUser, isBaProgramEnabled } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Mobile equivalent of /account/ba/upload: authenticated PAN/cheque upload. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    if (!(await isBaProgramEnabled())) {
      return jsonError(403, "BA_DISABLED", "The Business Associate programme is not active.");
    }
    const profile = await getBaProfileForUser(userId);
    if (
      !profile ||
      (profile.frontendStatus !== "APPROVED" && profile.frontendStatus !== "APPROVED_NO_BANK")
    ) {
      return jsonError(
        403,
        "BA_NOT_APPROVED",
        "Your Business Associate application is not approved.",
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError(400, "NO_FILE", "No file provided.");
    const validation = await validatePrivateDocumentContent(file);
    if (validation === "FILE_TOO_LARGE") {
      return jsonError(400, "TOO_LARGE", "File is larger than 5 MB.");
    }
    if (validation) {
      return jsonError(400, validation === "CONTENT_MISMATCH" ? "CONTENT_MISMATCH" : "BAD_TYPE", validation === "CONTENT_MISMATCH" ? "File content doesn't match its extension." : validation === "UNSAFE_PDF" ? "PDFs containing scripts or automatic actions aren't allowed." : "Only PDF, JPG, PNG or WEBP files are allowed.");
    }

    const uploaded = await uploadPrivateDocument(file, "ba-documents");
    return jsonOk({ url: uploaded.storageKey });
  });
}
