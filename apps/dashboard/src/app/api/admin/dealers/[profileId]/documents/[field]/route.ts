import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import { requireSession } from "@/lib/session-guard";
import { privateDocumentResponse } from "@/lib/private-document-response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string; field: string }> },
) {
  await requireSession(["ADMIN"]);
  const { profileId, field } = await params;
  if (field !== "gst" && field !== "licence") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const profile = await prisma.dealerProfile.findUnique({
    where: { id: profileId },
    select: { gstDocUrl: true, licenseDocUrl: true },
  });
  return privateDocumentResponse(
    field === "gst" ? (profile?.gstDocUrl ?? null) : (profile?.licenseDocUrl ?? null),
  );
}
