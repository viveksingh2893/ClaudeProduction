import { NextResponse, type NextRequest } from "next/server";
import { redeemPrivateDocumentDownload } from "@kisan4u/auth";
import { privateDocumentResponse } from "@/lib/private-document-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const redeemed = await redeemPrivateDocumentDownload((await params).token);
  if (!redeemed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return privateDocumentResponse(redeemed.storageKey);
}
