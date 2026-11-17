import { NextRequest } from "next/server";
import { deleteNotification } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Delete one notification. Ownership is enforced inside deleteNotification (scoped to userId). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const { id } = await params;
    const result = await deleteNotification(userId, id);
    if (!result.ok) return jsonError(404, "NOT_FOUND", result.error);
    return jsonOk({ ok: true });
  });
}
