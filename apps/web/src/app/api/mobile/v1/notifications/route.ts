import { NextRequest } from "next/server";
import { getUnreadNotificationCount, listNotificationsForUser } from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** The signed-in user's notification feed + unread badge count. Any authenticated role has a feed. */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const [notifications, unreadCount] = await Promise.all([
      listNotificationsForUser(userId, 50),
      getUnreadNotificationCount(userId),
    ]);
    return jsonOk({ notifications, unreadCount });
  });
}
