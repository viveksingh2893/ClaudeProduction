import { NextRequest } from "next/server";
import { markAllNotificationsRead } from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Marks every unread notification for the signed-in user as read (called when they open the list). */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    await markAllNotificationsRead(userId);
    return jsonOk({ ok: true });
  });
}
