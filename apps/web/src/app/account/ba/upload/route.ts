import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";

/**
 * BA Form 2 document upload (PAN copy / cancelled cheque). Authenticated —
 * only a signed-in user uploading their own BA docs. Returns a
 * `/api/uploads/...` path the form echoes back as panDocKey / chequeDocKey
 * (the validator restricts those fields to that prefix).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
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
      { ok: false, error: validation === "CONTENT_MISMATCH" ? "File content doesn't match its extension." : validation === "UNSAFE_PDF" ? "PDFs containing scripts or automatic actions aren't allowed." : "Only PDF, JPG, PNG or WEBP files are allowed." },
      { status: 400 },
    );
  }

  const uploaded = await uploadPrivateDocument(file, "ba-documents");
  return NextResponse.json({ ok: true, url: uploaded.storageKey });
}
