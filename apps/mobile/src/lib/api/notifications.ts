import { api } from "@/lib/api-client";

export type NotificationDTO = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

export function getNotifications() {
  return api.get<{ notifications: NotificationDTO[]; unreadCount: number }>(
    "/api/mobile/v1/notifications",
  );
}

export function markNotificationsRead() {
  return api.post<{ ok: true }>("/api/mobile/v1/notifications/read");
}

export function deleteNotification(id: string) {
  return api.delete<{ ok: true }>(`/api/mobile/v1/notifications/${id}`);
}

export function registerPushToken(token: string, platform: "android" | "ios") {
  return api.post<{ ok: true }>("/api/mobile/v1/notifications/register-token", { token, platform });
}

export function unregisterPushToken(token: string) {
  return api.post<{ ok: true }>("/api/mobile/v1/notifications/unregister-token", { token });
}
