import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { uploadPrivateDocument, validatePrivateDocumentContent } from "@kisan4u/providers";

/** Admin uploading a BA's KYC document on their behalf. */
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
    return NextResponse.json({ ok: false, error: validation === "CONTENT_MISMATCH" ? "File content doesn't match its extension." : validation === "UNSAFE_PDF" ? "PDFs containing scripts or automatic actions aren't allowed." : "Unsupported file type." }, { status: 400 });
  }
  const uploaded = await uploadPrivateDocument(file, "ba-documents");
  return NextResponse.json({ ok: true, url: uploaded.storageKey });
}
