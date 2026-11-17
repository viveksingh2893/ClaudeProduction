import { listNotificationsForUser, markAllNotificationsRead } from "@kisan4u/orders";
import { EmptyState, PageContainer, PageHeader } from "@kisan4u/ui";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/session-guard";
import { NotificationsList } from "./notifications-list";

export default async function NotificationsPage() {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  const notifications = await listNotificationsForUser(session.user.id);
  // Opening this page is the "read" action — every notification currently
  // visible here is marked read immediately, same convention as a typical
  // in-app notification centre.
  await markAllNotificationsRead(session.user.id);

  return (
    <PageContainer maxWidth="700px" className="py-10">
      <PageHeader
        title="Notifications"
        description="Updates about your orders, delivered here as soon as your seller (or Kisan4U admin) acts on them."
      />
      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" aria-hidden="true" />}
          title="No notifications yet"
          description="Order updates will show up here."
        />
      ) : (
        <NotificationsList notifications={notifications} />
      )}
    </PageContainer>
  );
}
