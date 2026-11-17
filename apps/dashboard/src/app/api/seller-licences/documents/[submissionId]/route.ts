import { NextResponse, type NextRequest } from "next/server";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@kisan4u/db";
import { resolvePrivateDocumentPath } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * The ONLY way to read a selling-licence document back — unlike
 * apps/web's generic `/api/uploads/[...path]` route (fully public, no auth
 * check at all), this one is authenticated and ownership-checked, and the
 * file it reads lives under a physically separate storage root that
 * route can never resolve into (see packages/providers/src/storage.ts's
 * PRIVATE_UPLOAD_ROOT doc comment). The URL only ever contains the
 * submission's cuid, never a filesystem path or storage key.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireSession(["ADMIN", "SELLER"]);

  const submission = await prisma.sellerLicenceSubmission.findUnique({
    where: { id: (await params).submissionId },
    select: {
      documentStorageKey: true,
      documentMimeType: true,
      seller: { select: { userId: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (session.user.role === "SELLER" && submission.seller.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = resolvePrivateDocumentPath(submission.documentStorageKey);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType =
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    submission.documentMimeType ??
    "application/octet-stream";
  const bytes = await readFile(filePath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="document${path.extname(filePath).toLowerCase()}"`,
      // Authenticated + access-controlled content — never cached publicly
      // or by a shared cache, unlike the public uploads route.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
