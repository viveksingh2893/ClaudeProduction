import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { PushNotificationsManager } from "./push-notifications-manager";

/**
 * Compose a push + in-app notification and send it to all customers, all
 * dealers, or everyone. Order-lifecycle notifications (placed, accepted,
 * confirmed, packed, in transit, delivered, cancelled, refunded) and the
 * abandoned-cart nudge are sent automatically by @kisan4u/orders — this
 * tab is only for one-off announcements.
 *
 * Push delivery needs Expo/FCM credentials (`EXPO_ACCESS_TOKEN` +
 * google-services). Until those are set, everything here still records an
 * in-app notification for each recipient; only the device push is held.
 */
export default async function AdminNotificationsPage() {
  await requireSession(["ADMIN"]);

  const [deviceCount, reachableUsers] = await Promise.all([
    prisma.pushDevice.count(),
    prisma.pushDevice.findMany({ select: { userId: true }, distinct: ["userId"] }),
  ]);
  const pushEnabled = Boolean(process.env.EXPO_ACCESS_TOKEN);

  return (
    <PageContainer className="py-8" maxWidth="800px">
      <PageHeader title="Push notifications" />
      <PushNotificationsManager
        pushEnabled={pushEnabled}
        deviceCount={deviceCount}
        reachableUserCount={reachableUsers.length}
      />
    </PageContainer>
  );
}
