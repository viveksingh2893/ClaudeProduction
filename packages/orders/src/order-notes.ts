import { prisma, type UserRole } from "@kisan4u/db";

/**
 * Internal order remarks — free-text working notes an admin / scheduling-team
 * member attaches to a SellerOrder at any point in its lifecycle,
 * independent of a status change (unlike OrderStatusHistory.note). Never
 * shown to the seller or customer. Append-only; callers are responsible for
 * their own auth gate.
 */

export const ORDER_NOTE_MAX_LENGTH = 2000;

export type OrderNoteDTO = {
  id: string;
  body: string;
  authorName: string;
  authorRole: UserRole;
  createdAt: Date;
};

export async function listOrderNotes(sellerOrderId: string): Promise<OrderNoteDTO[]> {
  return prisma.orderNote.findMany({
    where: { sellerOrderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, authorName: true, authorRole: true, createdAt: true },
  });
}

export async function addOrderNote(input: {
  sellerOrderId: string;
  body: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
}): Promise<{ ok: true; note: OrderNoteDTO } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (body.length === 0) return { ok: false, error: "Enter a remark." };
  if (body.length > ORDER_NOTE_MAX_LENGTH) {
    return { ok: false, error: `Keep the remark under ${ORDER_NOTE_MAX_LENGTH} characters.` };
  }

  const order = await prisma.sellerOrder.findUnique({
    where: { id: input.sellerOrderId },
    select: { id: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const note = await prisma.orderNote.create({
    data: {
      sellerOrderId: input.sellerOrderId,
      body,
      authorId: input.authorId,
      authorName: input.authorName,
      authorRole: input.authorRole,
    },
    select: { id: true, body: true, authorName: true, authorRole: true, createdAt: true },
  });
  return { ok: true, note };
}
