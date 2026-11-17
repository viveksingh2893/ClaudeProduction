import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolvePrivateDocumentPath } from "@kisan4u/providers";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function privateDocumentResponse(storageKey: string | null): Promise<NextResponse> {
  if (!storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filePath = resolvePrivateDocumentPath(storageKey);
  if (!filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await stat(filePath);
    const bytes = await readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="document${path.extname(filePath).toLowerCase()}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
