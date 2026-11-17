import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUserPrivateDocumentKey, isPrivateDocumentField } from "@/lib/user-private-document";
import { privateDocumentResponse } from "@/lib/private-document-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ field: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { field } = await params;
  if (!isPrivateDocumentField(field))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return privateDocumentResponse(await getUserPrivateDocumentKey(session.user.id, field));
}
