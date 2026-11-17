import { NextRequest, NextResponse } from "next/server";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { isPrivateKycUploadSubpath, resolveUploadPath } from "@kisan4u/providers";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/**
 * Serves files written by localStorageProvider (see
 * packages/providers/src/storage.ts) — reads from disk on every request
 * rather than relying on Next's `public/` static serving, which only
 * picks up files that existed when the production server booted.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: subpath } = await params;
  if (isPrivateKycUploadSubpath(subpath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const filePath = resolveUploadPath(subpath);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType =
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const bytes = await readFile(filePath);
  const range = req.headers.get("range");
  const commonHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // Filenames are random UUIDs, never reused — safe to cache forever.
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const suffixLength = !match?.[1] && match?.[2] ? Number(match[2]) : null;
    const start =
      suffixLength == null ? Number(match?.[1] ?? 0) : Math.max(0, fileStat.size - suffixLength);
    const requestedEnd = suffixLength == null && match?.[2] ? Number(match[2]) : fileStat.size - 1;
    const end = Math.min(requestedEnd, fileStat.size - 1);
    if (
      !match ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...commonHeaders, "Content-Range": `bytes */${fileStat.size}` },
      });
    }
    const chunk = bytes.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      },
    });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      ...commonHeaders,
      "Content-Length": String(fileStat.size),
    },
  });
}
