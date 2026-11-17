import { NextResponse, type NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { prisma } from "@kisan4u/db";
import { resolvePrivateDocumentPath } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

/**
 * The only way to read a seller agreement PDF back — admins for any
 * seller, a seller only for their own. Same private storage and
 * authenticated-route pattern as the selling-licence documents
 * (api/seller-licences/documents/[submissionId]).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerProfileId: string }> },
) {
  const session = await requireSession(["ADMIN", "SELLER"]);

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: (await params).sellerProfileId },
    select: { userId: true, agreementStorageKey: true, agreementFileName: true },
  });
  if (!seller?.agreementStorageKey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (session.user.role === "SELLER" && seller.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = resolvePrivateDocumentPath(seller.agreementStorageKey);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const fileName = (seller.agreementFileName ?? "seller-agreement.pdf").replace(/[^\w.\- ]/g, "_");
  const bytes = await readFile(filePath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
