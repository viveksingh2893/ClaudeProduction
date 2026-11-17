import { prisma } from "@kisan4u/db";
import { getOrCreateWallet } from "./wallet";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/**
 * Dealer-only reward points (Wallet.loyaltyPoints — reserved for exactly
 * this since Phase 4 planning, never written until now). Awarded once per
 * SellerOrder, the moment it reaches DELIVERED (the same single trigger
 * point settlement/payment-auto-complete already use — see
 * order-workflow.ts's applyMockLogisticsEventForOrder). Not redeemable
 * yet: this only accumulates and displays a balance, same as the money
 * wallet did before top-up/checkout existed.
 */
export async function awardLoyaltyPointsForDeliveredOrder(
  tx: TxClient,
  sellerOrderId: string,
): Promise<void> {
  const order = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: {
      customerId: true,
      customerType: true,
      items: { select: { loyaltyPoints: true, quantity: true } },
    },
  });
  if (order.customerType !== "DEALER") return;

  const points = order.items.reduce((sum, item) => sum + item.loyaltyPoints * item.quantity, 0);
  if (points <= 0) return;

  const wallet = await getOrCreateWallet(tx, order.customerId, "DEALER");
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { loyaltyPoints: { increment: points } },
  });
  await tx.loyaltyPointsTransaction.create({
    data: {
      walletId: wallet.id,
      type: "CREDIT",
      reason: "ORDER_DELIVERED",
      points,
      balanceAfter: updated.loyaltyPoints,
      referenceType: "seller_order",
      referenceId: sellerOrderId,
    },
  });
}

/**
 * Reverses the points a single delivered line contributed — for a
 * refund/return approved after delivery. Not called from anywhere yet:
 * the refund/return approval workflow (RefundRequest status transitions)
 * has no implementation in this codebase beyond its schema and a
 * read-only admin listing, so there's no live trigger point to wire this
 * into. Ready to call once that workflow is built.
 */
export async function reverseLoyaltyPointsForOrderItem(
  tx: TxClient,
  orderItemId: string,
): Promise<void> {
  const item = await tx.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    select: {
      loyaltyPoints: true,
      quantity: true,
      sellerOrder: { select: { customerId: true, customerType: true } },
    },
  });
  if (item.sellerOrder.customerType !== "DEALER") return;

  const points = item.loyaltyPoints * item.quantity;
  if (points <= 0) return;

  const wallet = await getOrCreateWallet(tx, item.sellerOrder.customerId, "DEALER");
  const reversed = Math.min(points, wallet.loyaltyPoints);
  if (reversed <= 0) return;

  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { loyaltyPoints: { decrement: reversed } },
  });
  await tx.loyaltyPointsTransaction.create({
    data: {
      walletId: wallet.id,
      type: "DEBIT",
      reason: "ORDER_REFUND_REVERSAL",
      points: reversed,
      balanceAfter: updated.loyaltyPoints,
      referenceType: "order_item",
      referenceId: orderItemId,
    },
  });
}
