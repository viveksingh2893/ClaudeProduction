import { NextRequest, NextResponse } from "next/server";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";
import { auth } from "@/auth";

/**
 * GST / licence document upload for a SIGNED-IN customer's "Become a
 * Dealer" form (LoggedInApplicationForm). The signed-out onboarding flow
 * uses ./upload-document/route.ts instead, which is gated by the
 * DealerOnboardingSession cookie; this one is gated by the real session.
 * Returns a /api/uploads/dealer-documents/... URL, the shape
 * dealerApplicationSchema's gstDocUrl / licenseDocUrl accept.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "CUSTOMER") {
    return NextResponse.json({ ok: false, error: "Please log in as a customer." }, { status: 401 });
  }

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
