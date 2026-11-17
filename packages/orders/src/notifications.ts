import { prisma } from "@kisan4u/db";
import { sendPushToUser, sendPushToUsers } from "./push";

/**
 * In-app notification service — the `Notification` model (id, userId,
 * title, body, imageUrl, linkUrl, isRead, createdAt) is the buyer-facing
 * feed surfaced at /notifications on the storefront and in the mobile app.
 *
 * Every write here also fires an Expo push to the recipient's registered
 * devices (see push.ts). Push delivery is a graceful no-op until
 * `EXPO_ACCESS_TOKEN` / FCM credentials are configured, so the in-app feed
 * is always populated regardless. `linkUrl` doubles as the push deep-link
 * target.
 *
 * Always called AFTER the triggering `$transaction` has committed — same
 * convention as `writeAuditLog` (see status-transitions.ts/cancellation.ts)
 * — a notification is a side effect of a successful state change, not part
 * of the atomic write itself.
 */
export async function notifyBuyer(params: {
  customerId: string;
  title: string;
  body: string;
  linkUrl?: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: params.customerId,
      title: params.title,
      body: params.body,
      linkUrl: params.linkUrl,
    },
  });
  await sendPushToUser(params.customerId, {
    title: params.title,
    body: params.body,
    linkUrl: params.linkUrl,
  });
}

/** Same underlying Notification row as notifyBuyer, generically named for non-order flows (e.g. seller/dealer product-request updates). */
export async function notifyUser(params: {
  userId: string;
  title: string;
  body: string;
  linkUrl?: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: params.userId,
      title: params.title,
      body: params.body,
      linkUrl: params.linkUrl,
    },
  });
  await sendPushToUser(params.userId, {
    title: params.title,
    body: params.body,
    linkUrl: params.linkUrl,
  });
}

/** Fans a notification out to every ADMIN-role user — there's no single "admin inbox" concept in this schema, so every admin account gets their own row. */
export async function notifyAllAdmins(params: {
  title: string;
  body: string;
  linkUrl?: string;
}): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      title: params.title,
      body: params.body,
      linkUrl: params.linkUrl,
    })),
  });
  await sendPushToUsers(
    admins.map((a) => a.id),
    { title: params.title, body: params.body, linkUrl: params.linkUrl },
  );
}

/**
 * Compose-and-send used by the admin "Push notifications" tab: writes an
 * in-app row for every recipient in the audience AND pushes to their
 * devices. Returns how many users were targeted so the admin UI can
 * confirm.
 */
export async function broadcastNotification(params: {
  audience: "ALL_CUSTOMERS" | "ALL_DEALERS" | "EVERYONE";
  title: string;
  body: string;
  linkUrl?: string;
}): Promise<{ recipients: number }> {
  const roleFilter =
    params.audience === "ALL_CUSTOMERS"
      ? (["CUSTOMER"] as const)
      : params.audience === "ALL_DEALERS"
        ? (["DEALER"] as const)
        : (["CUSTOMER", "DEALER"] as const);

  const users = await prisma.user.findMany({
    where: { role: { in: [...roleFilter] }, isActive: true, isGuest: false },
    select: { id: true },
  });
  if (users.length === 0) return { recipients: 0 };

  const linkUrl = params.linkUrl?.trim() || undefined;

  // Chunk the in-app writes so a large audience doesn't build one huge
  // INSERT — createMany is fine but keep batches bounded.
  const ids = users.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    await prisma.notification.createMany({
      data: batch.map((userId) => ({
        userId,
        title: params.title,
        body: params.body,
        linkUrl,
      })),
    });
  }

  await sendPushToUsers(ids, { title: params.title, body: params.body, linkUrl });
  return { recipients: ids.length };
}

export async function listNotificationsForUser(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

/** Called when the buyer opens their notification list — marks everything currently visible as read in one write. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

/** Ownership is enforced by scoping the delete to userId — a notificationId belonging to another user simply matches zero rows rather than deleting anything. */
export async function deleteNotification(
  userId: string,
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
  if (result.count === 0) return { ok: false, error: "Notification not found." };
  return { ok: true };
}

export async function clearAllNotifications(userId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId } });
}
