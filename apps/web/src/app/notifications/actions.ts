"use server";

import { revalidatePath } from "next/cache";
import { deleteNotification, clearAllNotifications } from "@kisan4u/orders";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function clearNotificationAction(notificationId: string): Promise<Result> {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  const result = await deleteNotification(session.user.id, notificationId);
  if (result.ok) revalidatePath("/notifications");
  return result;
}

export async function clearAllNotificationsAction(): Promise<Result> {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  await clearAllNotifications(session.user.id);
  revalidatePath("/notifications");
  return { ok: true };
}
