import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import { requireSession } from "@/lib/session-guard";
import { privateDocumentResponse } from "@/lib/private-document-response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; field: string }> },
) {
  await requireSession(["ADMIN"]);
  const { id, field } = await params;
  if (field !== "gst" && field !== "pan") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const profile = await prisma.sellerProfile.findUnique({
    where: { id },
    select: { gstDocUrl: true, panDocUrl: true },
  });
  return privateDocumentResponse(
    field === "gst" ? (profile?.gstDocUrl ?? null) : (profile?.panDocUrl ?? null),
  );
}
