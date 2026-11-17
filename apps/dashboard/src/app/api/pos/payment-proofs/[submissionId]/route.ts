import { NextResponse, type NextRequest } from "next/server";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@kisan4u/db";
import { resolvePrivateDocumentPath } from "@kisan4u/providers";
import { hasPermission } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";
import { PAYMENT_VERIFICATION_MODULE_KEY } from "@/lib/payment-verification-guard";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * The ONLY way to read a POS payment-proof screenshot back — same
 * authenticated, ownership-checked, physically-separate-storage-root
 * pattern as apps/dashboard's seller-licence document route. ADMIN can
 * always view any proof (they're the one approving/rejecting it). A STAFF
 * viewer can view a proof either because they uploaded it themselves (an
 * agent must never be able to browse another agent's payment screenshots
 * by guessing ids), or because they hold the "Payment Verifier" role's
 * payment-verification:VIEW permission — that role's entire job is
 * reviewing OTHER agents' screenshots (see
 * apps/dashboard/src/app/admin/payment-verification), so the plain
 * ownership check alone would 404 every screenshot it actually needs to
 * show (a real bug hit in testing — rendered as a broken-image icon, not
 * an error, since this is a bare <img src>).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireSession(["ADMIN", "STAFF"]);

  const submission = await prisma.posPaymentProofSubmission.findUnique({
    where: { id: (await params).submissionId },
    select: {
      screenshotStorageKey: true,
      screenshotMimeType: true,
      checkoutGroup: { select: { placedByUserId: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    session.user.role === "STAFF" &&
    submission.checkoutGroup.placedByUserId !== session.user.id
  ) {
    const canReview = await hasPermission(session.user.id, PAYMENT_VERIFICATION_MODULE_KEY, "VIEW");
    if (!canReview) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const filePath = resolvePrivateDocumentPath(submission.screenshotStorageKey);
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
    submission.screenshotMimeType ??
    "application/octet-stream";
  const bytes = await readFile(filePath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="payment-proof${path.extname(filePath).toLowerCase()}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
