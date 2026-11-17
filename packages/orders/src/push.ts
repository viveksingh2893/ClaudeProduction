import { prisma } from "@kisan4u/db";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";

/**
 * Expo push delivery — the wire between an in-app `Notification` row (see
 * notifications.ts) and the buyer's phone. Every helper here is a graceful
 * no-op until Expo/FCM credentials are configured:
 *
 *   - `EXPO_ACCESS_TOKEN` must be set for `sendPush*` to actually dispatch.
 *     Without it the functions return immediately having done nothing, so
 *     the whole notification system keeps working (in-app feed, admin tab,
 *     token registration) before Firebase is wired up.
 *   - `registerPushDevice` / `unregisterPushDevice` always run — the app
 *     can start collecting tokens now so delivery lights up the moment the
 *     credentials land, with no client redeploy.
 *
 * Called AFTER the triggering transaction has committed, same convention
 * as notifyBuyer / writeAuditLog — a push is a side effect of a committed
 * state change, never part of the atomic write.
 */

let cachedClient: Expo | null = null;

function pushEnabled(): boolean {
  return Boolean(process.env.EXPO_ACCESS_TOKEN);
}

function client(): Expo {
  if (!cachedClient) {
    cachedClient = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  }
  return cachedClient;
}

/**
 * Records (or refreshes) an Expo push token for a user. Upsert keyed on
 * the token itself: if the same physical device later signs in as a
 * different account, the row is re-pointed rather than duplicated. A
 * malformed token is silently ignored — the client shouldn't be able to
 * poison the table, and there's nothing the user can do about it anyway.
 */
export async function registerPushDevice(params: {
  userId: string;
  pushToken: string;
  platform?: string;
}): Promise<void> {
  const { userId, pushToken } = params;
  if (!Expo.isExpoPushToken(pushToken)) return;
  const platform = params.platform === "ios" ? "ios" : "android";
  await prisma.pushDevice.upsert({
    where: { pushToken },
    create: { userId, pushToken, platform },
    update: { userId, platform, lastSeenAt: new Date() },
  });
}

/** Removes a token on explicit logout. Scoped to userId so one account can't unregister another's device. */
export async function unregisterPushDevice(params: {
  userId: string;
  pushToken: string;
}): Promise<void> {
  await prisma.pushDevice.deleteMany({
    where: { pushToken: params.pushToken, userId: params.userId },
  });
}

async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await prisma.pushDevice.deleteMany({ where: { pushToken: { in: tokens } } });
}

type PushPayload = {
  title: string;
  body: string;
  /** Deep-link target carried in the notification `data` so a tap can route in-app. */
  linkUrl?: string | null;
};

/**
 * Sends a push to every registered device of a single user, unless they
 * have turned push off in NotificationPreference. Prunes tokens the Expo
 * service reports as no longer registered so the table self-heals.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  await sendPushToUsers([userId], payload);
}

/** Broadcast variant — used by the admin "compose push" tab. Preferences are honored per recipient. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!pushEnabled() || userIds.length === 0) return;

  const uniqueIds = [...new Set(userIds)];

  // Recipients who have explicitly disabled push (absence of a row = on).
  const optedOut = new Set(
    (
      await prisma.notificationPreference.findMany({
        where: { userId: { in: uniqueIds }, pushEnabled: false },
        select: { userId: true },
      })
    ).map((r) => r.userId),
  );
  const targetIds = uniqueIds.filter((id) => !optedOut.has(id));
  if (targetIds.length === 0) return;

  const devices = await prisma.pushDevice.findMany({
    where: { userId: { in: targetIds } },
    select: { pushToken: true },
  });
  const tokens = devices.map((d) => d.pushToken).filter((t) => Expo.isExpoPushToken(t));
  if (tokens.length === 0) return;

  const data: Record<string, string> = {};
  if (payload.linkUrl) data.linkUrl = payload.linkUrl;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    sound: "default",
    priority: "high",
    channelId: "default",
    data,
  }));

  const expo = client();
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  const deadTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      receipts.forEach((ticket, i) => {
        tickets.push(ticket);
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const to = chunk[i]?.to;
          if (typeof to === "string") deadTokens.push(to);
        }
      });
    } catch (error) {
      console.error("[push] sendPushNotificationsAsync failed", error);
    }
  }

  await deleteTokens(deadTokens);
}
