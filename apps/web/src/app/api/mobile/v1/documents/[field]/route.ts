import { type NextRequest } from "next/server";
import { issuePrivateDocumentDownload } from "@kisan4u/auth";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";
import { getUserPrivateDocumentKey, isPrivateDocumentField } from "@/lib/user-private-document";

export async function POST(req: NextRequest, { params }: { params: Promise<{ field: string }> }) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const { field } = await params;
    if (!isPrivateDocumentField(field)) return jsonError(404, "NOT_FOUND", "Document not found.");
    const storageKey = await getUserPrivateDocumentKey(userId, field);
    if (!storageKey) return jsonError(404, "NOT_FOUND", "Document not found.");
    const link = await issuePrivateDocumentDownload({ userId, field, storageKey });
    const origin = (process.env.SITE_ORIGIN ?? req.nextUrl.origin).replace(/\/$/, "");
    return jsonOk({
      url: `${origin}/api/mobile/v1/documents/download/${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
    });
  });
}
