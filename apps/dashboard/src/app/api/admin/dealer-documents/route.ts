import { NextRequest, NextResponse } from "next/server";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

/**
 * Admin re-upload of a dealer's KYC document (GST or licence copy) from
 * the dealer detail page. Mirrors the storefront onboarding upload
 * (apps/web/src/app/register/dealer/upload-document) — same "dealer-documents"
 * bucket and same /api/uploads/... URL shape, so the value slots straight
 * into DealerProfile.gstDocUrl / licenseDocUrl (or its pendingChanges
 * copy). The returned URL is echoed back through
 * proposeDealerProfileChangesAction, which is the actual approval gate.
 */
export async function POST(req: NextRequest) {
  await requireSession(["ADMIN"]);

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
  }
  const validation = await validatePrivateDocumentContent(file);
  if (validation === "FILE_TOO_LARGE") {
    return NextResponse.json({ ok: false, error: "File is larger than 5 MB." }, { status: 400 });
  }
  if (validation) {
    return NextResponse.json(
      { ok: false, error: validation === "CONTENT_MISMATCH" ? "File content doesn't match its extension." : validation === "UNSAFE_PDF" ? "PDFs containing scripts or automatic actions aren't allowed." : "Only PDF, JPG, PNG, or WEBP files are allowed." },
      { status: 400 },
    );
  }

  const uploaded = await uploadPrivateDocument(file, "dealer-documents");
  return NextResponse.json({ ok: true, url: uploaded.storageKey });
}
