import { prisma } from "@kisan4u/db";

/**
 * Same shape and behavior as packages/orders/src/notifications.ts's
 * notifyUser/notifyAllAdmins — duplicated here for the same reason as
 * ./audit.ts (packages/orders already depends on packages/catalog, so
 * catalog can't import back from orders without a cycle). Both write to
 * the same generic Notification model.
 */
export async function notifyUser(params: {
  userId: string;
  title: string;
  body: string;
}): Promise<void> {
  await prisma.notification.create({
    data: { userId: params.userId, title: params.title, body: params.body },
  });
}

export async function notifyAllAdmins(params: { title: string; body: string }): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await prisma.notification.createMany({
    data: admins.map((a) => ({ userId: a.id, title: params.title, body: params.body })),
  });
}
