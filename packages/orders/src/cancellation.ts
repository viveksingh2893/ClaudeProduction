import { prisma, Prisma, type UserRole, type OrderStatus, type RefundMethod } from "@kisan4u/db";
import type {
  CancellationRequestInput,
  AdminCancellationDecisionInput,
  SellerRejectOrderInput,
} from "@kisan4u/validators";
import { recordStatusChange } from "./status-transitions";
import { restoreStockForSellerOrder, hasStockBeenDeducted } from "./stock";
import { writeAuditLog } from "./audit";
import { notifyBuyer } from "./notifications";
import {
  nonWalletPaidSoFarFor,
  validateRefundMethodForOrder,
  autoCompleteCancellationRefund,
  type CancellationRefundOutcome,
} from "./refunds";
import { paidSoFarFor } from "./payment-collection";
import { cancelCourierShipmentForOrder } from "./courier-cancel";
import { round2 } from "./money";

export type CancellationResult = { ok: true } | { ok: false; error: string };

/** Turns an autoCompleteCancellationRefund outcome into the trailing sentence of a buyer-facing cancellation notice. */
function cancellationRefundNoticeSuffix(outcome: CancellationRefundOutcome): string {
  if (!outcome.attempted) return "";
  if (outcome.completed) {
    return ` A refund of ₹${outcome.amount.toFixed(2)} has been sent to your chosen destination.`;
  }
  return ` A refund of ₹${outcome.amount.toFixed(2)} has been raised and our team will complete it shortly.`;
}

/** Must exactly match the CANCELLATION_REQUESTED transition targets in status-transitions.ts. */
const REVERTIBLE_STATUSES: OrderStatus[] = [
  "CONFIRMED",
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
];

type OrderWithPaymentAllocations = Prisma.SellerOrderGetPayload<{
  include: { paymentAllocations: { include: { payment: true } } };
}>;

/**
 * Money side of a cancelled order: create ONE **PENDING** order-level
 * RefundRequest covering the whole refundable amount — the wallet-funded
 * slice AND any gateway/COD money captured. Nothing is credited or
 * refunded here: an admin approves the request (decideReturnRequest, which
 * handles both returns and these cancellation refunds), and completeRefund
 * then splits it back by channel — the wallet-funded part always to the
 * wallet, the rest by the customer's chosen cancellationRefundMethod
 * (Wallet or Original source / Razorpay). Must be called from inside a
 * `prisma.$transaction`.
 *
 * Shared by decideCancellation's approve branch, cancelPendingOrderByCustomer
 * (buyer self-cancel of a still-pending order) and order-workflow.ts's
 * cancelPendingOrder — the money handling is identical, only the status the
 * order is coming FROM differs.
 */
export async function settleMoneyForCancelledOrder(
  tx: Prisma.TransactionClient,
  order: OrderWithPaymentAllocations,
  actor: { id: string; role: UserRole },
  note?: string | null,
): Promise<void> {
  const totalRefundable = paidSoFarFor(order.paymentAllocations);
  if (totalRefundable <= 0.01) return;

  const refundRequest = await tx.refundRequest.create({
    data: {
      sellerOrderId: order.id,
      orderItemId: null,
      customerId: order.customerId,
      status: "PENDING",
      reason: "Order cancelled — refund of amount already paid",
      imageUrls: [],
      amount: round2(totalRefundable),
      refundMethod: order.cancellationRefundMethod ?? "WALLET",
      reviewNote: note,
    },
  });
  await tx.refundStatusHistory.create({
    data: {
      refundRequestId: refundRequest.id,
      status: "PENDING",
      changedById: actor.id,
      changedByRole: actor.role,
      message:
        actor.role === "ADMIN"
          ? "Auto-created on cancellation — awaiting refund approval"
          : "Auto-created on buyer self-cancellation — awaiting refund approval",
    },
  });
}

/** Customer requests cancellation before transit (Phase 4 spec §M) — the transition map itself blocks this once the order reaches PICKED_UP/IN_TRANSIT/DELIVERED onward. */
export async function requestCancellation(
  customerId: string,
  actorRole: UserRole,
  input: CancellationRequestInput,
): Promise<CancellationResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, customerId },
    include: { paymentAllocations: { include: { payment: true } } },
  });
  if (!order) return { ok: false, error: "Order not found." };

  // Only asked (and only needed) when real, non-wallet money has actually
  // been captured for this order — an unpaid COD order or one paid
  // entirely from the wallet has nothing here to pick a method for; see
  // decideCancellation's own approve branch, the thing that actually acts
  // on this later. Re-checked here, not just trusted from the client —
  // same discipline as every other money-adjacent input in this codebase.
  const nonWalletPaid = nonWalletPaidSoFarFor(order.paymentAllocations);
  if (nonWalletPaid > 0.01 && !input.refundMethod) {
    return {
      ok: false,
      error: "Select how you'd like the amount you've already paid refunded.",
    };
  }
  if (input.refundMethod) {
    const methodError = validateRefundMethodForOrder(input.refundMethod, order.paymentMethod);
    if (methodError) return { ok: false, error: methodError };
  }

  const actor = { id: customerId, role: actorRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "CANCELLATION_REQUESTED",
      actor,
      "CUSTOMER",
      input.reason,
    );
    if (!transition.ok) return transition;
    if (nonWalletPaid > 0.01 && input.refundMethod) {
      await tx.sellerOrder.update({
        where: { id: order.id },
        data: { cancellationRefundMethod: input.refundMethod },
      });
    }
    return transition;
  });
  if (result.ok) {
    await writeAuditLog({
      actorId: customerId,
      actorRole,
      action: "CANCELLATION_REQUESTED",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: input.reason,
    });
  }
  return result;
}

/**
 * The buyer cancels their own order while it's still "Pending"
 * (PENDING_PAYMENT / PAYMENT_PARTIALLY_RECEIVED) — before the scheduling
 * team's confirm call, so nothing has happened yet: no stock was deducted,
 * the seller hasn't seen it. Goes straight to CANCELLED with no admin
 * approval, and settles the money exactly like an approved cancellation
 * (wallet credit-back + an APPROVED RefundRequest for any captured
 * advance, routed by the chosen refund method). Once an order is CONFIRMED
 * this path refuses it and the buyer must use requestCancellation instead.
 */
export async function cancelPendingOrderByCustomer(
  customerId: string,
  actorRole: UserRole,
  input: CancellationRequestInput,
): Promise<CancellationResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, customerId },
    include: { paymentAllocations: { include: { payment: true } } },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "PENDING_PAYMENT" && order.status !== "PAYMENT_PARTIALLY_RECEIVED") {
    return {
      ok: false,
      error:
        "This order is already being processed — request a cancellation and our team will review it.",
    };
  }

  const nonWalletPaid = nonWalletPaidSoFarFor(order.paymentAllocations);
  if (nonWalletPaid > 0.01 && !input.refundMethod) {
    return { ok: false, error: "Select how you'd like the amount you've already paid refunded." };
  }
  if (input.refundMethod) {
    const methodError = validateRefundMethodForOrder(input.refundMethod, order.paymentMethod);
    if (methodError) return { ok: false, error: methodError };
  }

  const actor = { id: customerId, role: actorRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "CANCELLED",
      actor,
      "CUSTOMER",
      input.reason,
    );
    if (!transition.ok) return transition;
    if (nonWalletPaid > 0.01 && input.refundMethod) {
      await tx.sellerOrder.update({
        where: { id: order.id },
        data: { cancellationRefundMethod: input.refundMethod },
      });
    }
    // No stock to restore — a pending order never had stock deducted (see
    // order-workflow.ts's confirmOrder). Refund any captured advance.
    await settleMoneyForCancelledOrder(
      tx,
      { ...order, cancellationRefundMethod: input.refundMethod ?? order.cancellationRefundMethod },
      actor,
      input.reason,
    );
    return transition;
  });

  if (!result.ok) return result;

  await writeAuditLog({
    actorId: customerId,
    actorRole,
    action: "PENDING_ORDER_SELF_CANCELLED",
    entityType: "SellerOrder",
    entityId: order.id,
    reason: input.reason,
  });
  const refundOutcome = await autoCompleteCancellationRefund(order.id, actor);
  await notifyBuyer({
    customerId: order.customerId,
    title: "Order cancelled",
    body: `Your order ${order.orderNumber} was cancelled.${cancellationRefundNoticeSuffix(refundOutcome)}`,
  });
  return { ok: true };
}

/** Seller-initiated rejection, pre-acceptance only (Phase 4 spec §O1) — reuses the same cancellation-request/admin-decision flow rather than inventing a separate status or auto-reassigning the order. */
export async function sellerRejectOrder(
  sellerId: string,
  actorUserId: string,
  input: SellerRejectOrderInput,
): Promise<CancellationResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, sellerId },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const actor = { id: actorUserId, role: "SELLER" as UserRole };
  const result = await prisma.$transaction((tx) =>
    recordStatusChange(
      tx,
      order.id,
      order.status,
      "CANCELLATION_REQUESTED",
      actor,
      "SELLER",
      input.reason,
    ),
  );
  if (result.ok) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: "SELLER",
      action: "SELLER_REJECTED_ORDER",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: input.reason,
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order rejected",
      body: `Your order ${order.orderNumber} was rejected by the seller. Reason: ${input.reason}`,
    });
  }
  return result;
}

/**
 * Admin approves (→ CANCELLED, restoring any stock already deducted) or
 * rejects (→ reverts to whatever status the order was in immediately
 * before the cancellation request) a pending cancellation request (Phase
 * 4 spec §M — "admin or authorized support may approve cancellation").
 */
export async function decideCancellation(
  adminUserId: string,
  input: AdminCancellationDecisionInput,
): Promise<CancellationResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId },
    include: { paymentAllocations: { include: { payment: true } } },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "CANCELLATION_REQUESTED") {
    return { ok: false, error: "This order has no pending cancellation request." };
  }

  const actor = { id: adminUserId, role: "ADMIN" as UserRole };

  if (input.approve) {
    const result = await prisma.$transaction(async (tx) => {
      const transition = await recordStatusChange(
        tx,
        order.id,
        order.status,
        "CANCELLED",
        actor,
        "ADMIN",
        input.note,
      );
      if (!transition.ok) return transition;
      if (hasStockBeenDeducted(order.status)) {
        await restoreStockForSellerOrder(tx, order.id, actor);
      }
      // Wallet credit-back + an APPROVED RefundRequest for any non-wallet
      // money already captured. A sibling seller order from the same
      // multi-seller checkout that ISN'T being cancelled keeps its own
      // share debited (PaymentAllocation stores this per seller order).
      await settleMoneyForCancelledOrder(tx, order, { id: adminUserId, role: "ADMIN" }, input.note);
      return transition;
    });
    if (!result.ok) return result;

    await writeAuditLog({
      actorId: adminUserId,
      actorRole: "ADMIN",
      action: "CANCELLATION_APPROVED",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: input.note,
    });
    // Tell the courier the order is off — RapidShyp cancel_order /
    // Delhivery /api/p/edit on the account it was booked on. Best-effort:
    // the order is already CANCELLED; a failed courier cancel is recorded
    // on the shipment's tracking history + audit log, not raised.
    await cancelCourierShipmentForOrder(order.id, actor);
    // settleMoneyForCancelledOrder's PENDING RefundRequest doesn't need a
    // second manual review — the admin approving this cancellation IS the
    // review. Auto-complete it now (wallet credits back immediately; a
    // Razorpay-paid slice auto-refunds through the gateway; POS/COD money
    // with no gateway source is left APPROVED for "Complete refund").
    const refundOutcome = await autoCompleteCancellationRefund(order.id, actor);
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order cancelled",
      body: `Your order ${order.orderNumber} was cancelled.${input.note ? ` Reason: ${input.note}` : ""}${cancellationRefundNoticeSuffix(refundOutcome)}`,
    });
    return { ok: true };
  }

  const priorStatusRow = await prisma.orderStatusHistory.findFirst({
    where: { sellerOrderId: order.id, status: { in: REVERTIBLE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  const revertTo: OrderStatus = priorStatusRow?.status ?? "CONFIRMED";

  const result = await prisma.$transaction((tx) =>
    recordStatusChange(
      tx,
      order.id,
      order.status,
      revertTo,
      actor,
      "ADMIN",
      input.note ?? "Cancellation request rejected",
    ),
  );
  if (result.ok) {
    await writeAuditLog({
      actorId: adminUserId,
      actorRole: "ADMIN",
      action: "CANCELLATION_REJECTED",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: input.note,
    });
  }
  return result;
}
