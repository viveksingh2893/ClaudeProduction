import { prisma, Prisma, type UserRole, type OrderStatus } from "@kisan4u/db";
import type { AcceptOrderInput, MarkPackedInput, SchedulePickupInput } from "@kisan4u/validators";
import { mockLogisticsProvider } from "@kisan4u/providers";
import {
  recordStatusChange,
  type TransitionSource,
  type TransitionActor,
} from "./status-transitions";
import { writeAuditLog } from "./audit";
import { runDeliveredSideEffects } from "./delivered-side-effects";
import { notifyBuyer, notifyUser } from "./notifications";
import {
  deductStockForSellerOrder,
  restoreStockForSellerOrder,
  hasStockBeenDeducted,
  InsufficientStockError,
} from "./stock";
import { settleMoneyForCancelledOrder } from "./cancellation";
import { autoCompleteCancellationRefund, settleMoneyForRtoOrder } from "./refunds";
import {
  selectLivePaymentProofSubmissions,
  isPaymentProofFullyApproved,
  requiredPaymentProofAmount,
} from "./pos-payment-proof";

export type WorkflowResult = { ok: true } | { ok: false; error: string };

/** Ownership-scoped: returns "not found" (never the row) if the order doesn't belong to this seller (Phase 4 spec §O — "seller must not see another seller's order"). */
async function getOwnSellerOrder(sellerId: string, sellerOrderId: string) {
  return prisma.sellerOrder.findFirst({ where: { id: sellerOrderId, sellerId } });
}

/**
 * Seller accepts the order and selects one of their OWN approved, active
 * pickup points in the same step (Phase 4 spec §K3) — a seller can never
 * select another seller's pickup point because the lookup itself is
 * scoped by `sellerId`.
 */
export async function acceptOrder(
  sellerId: string,
  actorUserId: string,
  input: AcceptOrderInput,
): Promise<WorkflowResult> {
  const order = await getOwnSellerOrder(sellerId, input.sellerOrderId);
  if (!order) return { ok: false, error: "Order not found." };

  const pickupPoint = await prisma.sellerPickupPoint.findFirst({
    where: { id: input.pickupPointId, sellerId, isActive: true, approvalStatus: "APPROVED" },
  });
  if (!pickupPoint)
    return { ok: false, error: "Select one of your approved, active pickup points." };

  const actor = { id: actorUserId, role: "SELLER" as UserRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "SELLER_ACCEPTED",
      actor,
      "SELLER",
      "Seller accepted the order",
    );
    if (!transition.ok) return transition;
    await tx.sellerOrder.update({
      where: { id: order.id },
      data: { pickupPointId: pickupPoint.id },
    });
    return transition;
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: "SELLER",
      action: "SELLER_ACCEPTED_ORDER",
      entityType: "SellerOrder",
      entityId: order.id,
      metadata: { pickupPointId: pickupPoint.id },
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order accepted",
      body: `Your order ${order.orderNumber} has been accepted and will be prepared for shipment.`,
    });
  }
  return result;
}

/**
 * Admin-side equivalent of acceptOrder — for a POS-style operation where
 * the seller may not act promptly (or at all), an admin can accept on
 * their behalf and pick one of THAT SELLER's own approved, active pickup
 * points (never scoped by the admin's own identity, since admin has no
 * pickup points of their own). Deliberately a real, audited workflow
 * function — not a raw status edit — so it still runs the exact same
 * pickup-point-attachment step the generic admin status-override was
 * blocked from skipping (see status-transitions.ts's
 * STATUSES_REQUIRING_PICKUP_POINT guard, added after two prior incidents
 * where a pickup-point-less order got stuck at SELLER_ACCEPTED/PACKED).
 */
export async function acceptOrderAsAdmin(
  actorUserId: string,
  input: AcceptOrderInput,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: input.sellerOrderId },
    include: { seller: { select: { userId: true, shopName: true } } },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const pickupPoint = await prisma.sellerPickupPoint.findFirst({
    where: {
      id: input.pickupPointId,
      sellerId: order.sellerId,
      isActive: true,
      approvalStatus: "APPROVED",
    },
  });
  if (!pickupPoint)
    return { ok: false, error: "Select one of the seller's approved, active pickup points." };

  const actor = { id: actorUserId, role: "ADMIN" as UserRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "SELLER_ACCEPTED",
      actor,
      "ADMIN",
      `Order accepted by admin on behalf of seller (${order.seller.shopName})`,
    );
    if (!transition.ok) return transition;
    await tx.sellerOrder.update({
      where: { id: order.id },
      data: { pickupPointId: pickupPoint.id },
    });
    return transition;
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: "ADMIN",
      action: "ADMIN_ACCEPTED_ORDER_FOR_SELLER",
      entityType: "SellerOrder",
      entityId: order.id,
      metadata: { pickupPointId: pickupPoint.id, sellerId: order.sellerId },
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order accepted",
      body: `Your order ${order.orderNumber} has been accepted and will be prepared for shipment.`,
    });
    await notifyUser({
      userId: order.seller.userId,
      title: "Order accepted on your behalf",
      body: `An admin accepted order ${order.orderNumber} on your behalf, using your "${pickupPoint.name}" pickup point.`,
    });
  }
  return result;
}

// --- Order confirmation gate (Kisan4U scheduling team) ---------------------
// Every order is placed as "Pending" (PENDING_PAYMENT / PAYMENT_PARTIALLY_
// RECEIVED) regardless of who placed it or how it was paid. The scheduling
// team calls the customer to confirm, then an admin runs confirmOrder (→
// CONFIRMED, stock deducted, seller notified — the order only becomes
// visible to the seller from this point, see order-queries.ts) or
// cancelPendingOrder (→ CANCELLED, any captured money refunded).

const PENDING_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAYMENT_PARTIALLY_RECEIVED"];

export async function confirmOrder(
  actorUserId: string,
  sellerOrderId: string,
  note?: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: {
      seller: { select: { userId: true } },
      checkoutGroup: {
        select: {
          placedByUserId: true,
          payments: { select: { totalAmount: true, walletAmountApplied: true }, take: 1 },
          paymentProofSubmissions: {
            select: { id: true, status: true, previousSubmissionId: true, amount: true },
          },
        },
      },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!PENDING_STATUSES.includes(order.status)) {
    return { ok: false, error: "Only a pending order can be confirmed." };
  }

  // A POS non-COD order (partial or full prepaid) can't be confirmed until
  // EVERY uploaded payment-proof screenshot (the buyer may have paid in
  // several instalments) has been APPROVED — the buyer paid outside the
  // app, so approval is the only evidence the money was actually received.
  // (COD has nothing to prove; a self-service order has no proof
  // submission at all — placedByUserId is null there.)
  if (order.checkoutGroup.placedByUserId != null && order.paymentMethod !== "COD") {
    const liveSubmissions = selectLivePaymentProofSubmissions(
      order.checkoutGroup.paymentProofSubmissions,
    );
    const payment = order.checkoutGroup.payments[0];
    const requiredAmount = payment ? requiredPaymentProofAmount(payment) : 0;
    if (!isPaymentProofFullyApproved(liveSubmissions, requiredAmount)) {
      const approvedTotal = liveSubmissions
        .filter((s) => s.status === "APPROVED")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const allDecidedButShort =
        liveSubmissions.length > 0 && liveSubmissions.every((s) => s.status === "APPROVED");
      return {
        ok: false,
        error:
          liveSubmissions.some((s) => s.status === "REJECTED")
            ? "One of this POS order's payment screenshots was rejected and needs to be re-uploaded before confirming."
            : liveSubmissions.some((s) => s.status === "PENDING")
              ? "Not every payment screenshot for this POS order has been approved yet. Approve them all in Payment Verification before confirming the order."
              : allDecidedButShort
                ? `Approved payment screenshots only cover ₹${approvedTotal.toFixed(2)} of the ₹${requiredAmount.toFixed(2)} required — upload and approve the remaining ₹${(requiredAmount - approvedTotal).toFixed(2)} before confirming the order.`
                : "The payment screenshot for this POS order hasn't been approved yet. Approve it in Payment Verification before confirming the order.",
      };
    }
  }

  const actor = { id: actorUserId, role: "ADMIN" as UserRole };
  let result: WorkflowResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      const transition = await recordStatusChange(
        tx,
        order.id,
        order.status,
        "CONFIRMED",
        actor,
        "ADMIN",
        note ?? "Order confirmed with the customer",
      );
      if (!transition.ok) return transition;
      // Stock is reserved here, at confirmation — never at placement, so a
      // pending order that gets cancelled never touched stock.
      await deductStockForSellerOrder(tx, order.id, actor);
      return transition;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error:
          "Can't confirm — there isn't enough stock for one of the items in this order. Restock it, or cancel the order.",
      };
    }
    throw error;
  }

  if (result.ok) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: "ADMIN",
      action: "ORDER_CONFIRMED",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: note,
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order confirmed",
      body: `Your order ${order.orderNumber} has been confirmed and is now being prepared for dispatch.`,
    });
    await notifyUser({
      userId: order.seller.userId,
      title: "New order to prepare",
      body: `Order ${order.orderNumber} has been confirmed by Kisan4U and is ready for you to schedule dispatch.`,
    });
  }
  return result;
}

const REVERTIBLE_STATUSES: OrderStatus[] = ["CONFIRMED", "SELLER_ACCEPTED", "PACKED"];

/**
 * Sends an order that was confirmed (or accepted/packed) back to Pending —
 * for when a logistics problem (no serviceable pickup point, an address
 * issue, etc.) makes it impossible to actually schedule the dispatch, and
 * the scheduling team needs to re-contact the customer rather than leave
 * the order stuck. Restores the stock confirmOrder deducted (in the same
 * transaction as the status change), so a later re-confirm deducts it
 * exactly once, never twice. Only reachable before PICKUP_SCHEDULED —
 * once a real shipment exists, this must go through cancellation instead.
 */
export async function revertConfirmedOrderToPending(
  actorUserId: string,
  sellerOrderId: string,
  note?: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    select: {
      id: true,
      status: true,
      orderNumber: true,
      customerId: true,
      sellerId: true,
      shipment: { select: { id: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!REVERTIBLE_STATUSES.includes(order.status)) {
    return {
      ok: false,
      error: "Only an order that's confirmed but not yet scheduled can be reverted to pending.",
    };
  }
  if (order.shipment) {
    return {
      ok: false,
      error: "This order already has a shipment — cancel the order instead of reverting it.",
    };
  }

  const actor = { id: actorUserId, role: "ADMIN" as UserRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "PENDING_PAYMENT",
      actor,
      "ADMIN",
      note ?? "Reverted to pending — could not be scheduled",
    );
    if (!transition.ok) return transition;
    if (hasStockBeenDeducted(order.status)) {
      await restoreStockForSellerOrder(tx, order.id, actor);
    }
    return transition;
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: "ADMIN",
      action: "ORDER_REVERTED_TO_PENDING",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: note,
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order confirmation on hold",
      body: `Order ${order.orderNumber} needs to be re-confirmed — our team will reach out shortly.`,
    });
  }
  return result;
}

export async function cancelPendingOrder(
  actorUserId: string,
  sellerOrderId: string,
  reason: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: { paymentAllocations: { include: { payment: true } } },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!PENDING_STATUSES.includes(order.status)) {
    return {
      ok: false,
      error:
        "Only a pending order can be cancelled here. Use the cancellation workflow for a confirmed order.",
    };
  }

  const actor = { id: actorUserId, role: "ADMIN" as UserRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "CANCELLED",
      actor,
      "ADMIN",
      reason,
    );
    if (!transition.ok) return transition;
    // No stock to restore — a pending order never had stock deducted
    // (see confirmOrder). Still refund any advance / prepaid amount.
    await settleMoneyForCancelledOrder(tx, order, { id: actorUserId, role: "ADMIN" }, reason);
    return transition;
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: "ADMIN",
      action: "PENDING_ORDER_CANCELLED",
      entityType: "SellerOrder",
      entityId: order.id,
      reason,
    });
    // settleMoneyForCancelledOrder created a PENDING cancellation
    // RefundRequest — the admin cancelling here already made the call, so
    // auto-complete it now rather than requiring a second manual approval
    // in the refund panel (wallet/Razorpay auto; POS/COD falls back to
    // "Complete refund").
    const refundOutcome = await autoCompleteCancellationRefund(order.id, {
      id: actorUserId,
      role: "ADMIN",
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order cancelled",
      body: `Your order ${order.orderNumber} was cancelled. Reason: ${reason}${
        refundOutcome.attempted
          ? refundOutcome.completed
            ? ` A refund of ₹${refundOutcome.amount.toFixed(2)} has been sent to your chosen destination.`
            : ` A refund of ₹${refundOutcome.amount.toFixed(2)} has been raised and our team will complete it shortly.`
          : ""
      }`,
    });
  }
  return result;
}

async function markPackedCore(
  sellerOrderId: string,
  currentStatus: OrderStatus,
  actor: TransitionActor,
  source: TransitionSource,
  note: string,
): Promise<WorkflowResult> {
  return prisma.$transaction((tx) =>
    recordStatusChange(tx, sellerOrderId, currentStatus, "PACKED", actor, source, note),
  );
}

export async function markPacked(
  sellerId: string,
  actorUserId: string,
  input: MarkPackedInput,
): Promise<WorkflowResult> {
  const order = await getOwnSellerOrder(sellerId, input.sellerOrderId);
  if (!order) return { ok: false, error: "Order not found." };

  const note = input.packageCount ? `Packed into ${input.packageCount} package(s)` : "Packed";
  return markPackedCore(
    order.id,
    order.status,
    { id: actorUserId, role: "SELLER" },
    "SELLER",
    note,
  );
}

/** Admin equivalent of markPacked — unscoped (no sellerId ownership check), matching acceptOrderAsAdmin's convention. Used by the RapidShyp-or-mock dispatch choice admin gets alongside the seller (see rapidshyp-shipping.ts's packAndSendToRapidShyp / packAndScheduleMockPickup below). */
export async function markPackedAsAdmin(
  adminUserId: string,
  sellerOrderId: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    select: { status: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  return markPackedCore(
    sellerOrderId,
    order.status,
    { id: adminUserId, role: "ADMIN" },
    "ADMIN",
    "Packed by admin",
  );
}

/**
 * "Request pickup" in Phase 4's mock logistics workflow (§Q): creates the
 * Shipment row with a mock AWB and moves the order to PICKUP_SCHEDULED.
 * The pickup point's address is snapshotted onto the shipment right now
 * (§K3 — "pickup-point address must be snapshotted into the order
 * shipment") so a later pickup-point edit never changes this shipment's
 * recorded origin.
 */
type SellerOrderForMockPickup = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerId: string;
  items: { totalWeightGrams: number }[];
  checkoutGroup: { addressSnapshot: { pincode: string } | null };
};

type PickupPointForSnapshot = {
  name: string;
  contactPerson: string;
  mobile: string;
  line1: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  landmark: string | null;
};

/**
 * Shared core behind schedulePickup (seller) and schedulePickupAsAdmin
 * below — creates the mock Shipment + first ShipmentStatusHistory row and
 * moves the order to PICKUP_SCHEDULED. Split out so both callers get
 * identical shipment-creation behavior, same convention as
 * applyShipmentStatusTransition/markPackedCore in this file.
 */
async function scheduleMockPickupCore(
  order: SellerOrderForMockPickup,
  pickupPoint: PickupPointForSnapshot,
  actor: TransitionActor,
  source: TransitionSource,
): Promise<WorkflowResult> {
  const totalWeightGrams = order.items.reduce((total, item) => total + item.totalWeightGrams, 0);
  const shipmentResult = await mockLogisticsProvider.createShipment({
    sellerOrderReference: order.orderNumber,
    originPincode: pickupPoint.pincode,
    destinationPincode: order.checkoutGroup.addressSnapshot?.pincode ?? "",
    weightGrams: totalWeightGrams,
  });

  const pickupPointSnapshot = {
    name: pickupPoint.name,
    contactPerson: pickupPoint.contactPerson,
    mobile: pickupPoint.mobile,
    line1: pickupPoint.line1,
    city: pickupPoint.city,
    district: pickupPoint.district,
    state: pickupPoint.state,
    pincode: pickupPoint.pincode,
    landmark: pickupPoint.landmark,
  };

  const result = await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        sellerOrderId: order.id,
        pickupPointSnapshot,
        awbNumber: shipmentResult.awbNumber,
        status: "PICKUP_SCHEDULED",
      },
    });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "PICKUP_SCHEDULED",
        rawProviderResponse: shipmentResult.rawResponse as Prisma.InputJsonValue,
      },
    });
    return recordStatusChange(
      tx,
      order.id,
      order.status,
      "PICKUP_SCHEDULED",
      actor,
      source,
      `AWB ${shipmentResult.awbNumber}`,
    );
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "PICKUP_SCHEDULED",
      entityType: "SellerOrder",
      entityId: order.id,
      metadata: { awbNumber: shipmentResult.awbNumber },
    });
    // "Ready for pickup" is deliberately notified here, not in markPacked —
    // this is the point a shipment/AWB actually exists, which is what
    // "ready for pickup" means. Fires exactly once whether the caller used
    // the combined web action (markPackedAndReadyForPickup / packAndScheduleMockPickup),
    // the separate PACK/SCHEDULE_PICKUP mobile-app steps, or the admin
    // equivalent — every path always ends up here.
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order packed and ready for pickup",
      body: `Your order ${order.orderNumber} has been packed and is ready for pickup.`,
    });
  }
  return result;
}

export async function schedulePickup(
  sellerId: string,
  actorUserId: string,
  input: SchedulePickupInput,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, sellerId },
    include: {
      pickupPoint: true,
      items: true,
      checkoutGroup: { include: { addressSnapshot: true } },
      shipment: true,
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.shipment) return { ok: false, error: "A shipment already exists for this order." };

  // Normally set by acceptOrder. An order can still reach here with no
  // pickup point if an admin manually forced its status past SELLER_ACCEPTED
  // (the generic admin status override doesn't run acceptOrder's pickup-point
  // logic) — recover by letting the seller supply one now.
  let pickupPoint = order.pickupPoint;
  if (!pickupPoint) {
    if (!input.pickupPointId)
      return { ok: false, error: "Accept the order and select a pickup point first." };
    pickupPoint = await prisma.sellerPickupPoint.findFirst({
      where: { id: input.pickupPointId, sellerId, isActive: true, approvalStatus: "APPROVED" },
    });
    if (!pickupPoint)
      return { ok: false, error: "Select one of your approved, active pickup points." };
    await prisma.sellerOrder.update({
      where: { id: order.id },
      data: { pickupPointId: pickupPoint.id },
    });
  }

  return scheduleMockPickupCore(
    order,
    pickupPoint,
    { id: actorUserId, role: "SELLER" },
    "LOGISTICS_PROVIDER",
  );
}

/**
 * Admin equivalent of schedulePickup — unscoped, and with no pickupPointId
 * fallback: an order reaching SELLER_ACCEPTED/PACKED always has one already
 * (STATUSES_REQUIRING_PICKUP_POINT in status-transitions.ts guarantees it),
 * so recovering a missing one here would only mask that guard failing.
 * Lets admin choose the manual/mock logistics path for a KISAN4U_COURIER
 * order during testing, same as the seller can — see rapidshyp-shipping.ts's
 * packAndScheduleMockPickup, which picks this or the seller-scoped
 * schedulePickup above depending on who's acting.
 */
export async function schedulePickupAsAdmin(
  adminUserId: string,
  sellerOrderId: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: {
      pickupPoint: true,
      items: true,
      checkoutGroup: { include: { addressSnapshot: true } },
      shipment: true,
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.shipment) return { ok: false, error: "A shipment already exists for this order." };
  if (!order.pickupPoint)
    return {
      ok: false,
      error: "This order has no pickup point set — the seller must accept it first.",
    };

  return scheduleMockPickupCore(order, order.pickupPoint, { id: adminUserId, role: "ADMIN" }, "ADMIN");
}

/**
 * "Pack & use manual logistics" — the mock-provider counterpart to
 * rapidshyp-shipping.ts's packAndSendToRapidShyp, offered alongside it so
 * seller/admin can explicitly choose either logistics path per
 * KISAN4U_COURIER order (see that file's doc comment for the full
 * picture — this is the "testing" fallback, TRANSPORT orders never had a
 * RapidShyp option to choose between in the first place). Packs first (if
 * not already) then schedules the mock pickup as one call — same
 * "hide PACKED behind one click" pattern markPackedAndReadyForPickup
 * already uses for TRANSPORT, just reachable here too.
 */
export async function packAndScheduleMockPickup(
  actor: { id: string; role: UserRole },
  sellerOrderId: string,
  scope?: { sellerId: string },
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, ...(scope ? { sellerId: scope.sellerId } : {}) },
    select: { status: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  if (order.status === "SELLER_ACCEPTED") {
    const packed = scope
      ? await markPacked(scope.sellerId, actor.id, { sellerOrderId })
      : await markPackedAsAdmin(actor.id, sellerOrderId);
    if (!packed.ok) return packed;
  } else if (order.status !== "PACKED") {
    return { ok: false, error: `Cannot schedule pickup for an order at ${order.status}.` };
  }

  return scope
    ? schedulePickup(scope.sellerId, actor.id, { sellerOrderId })
    : schedulePickupAsAdmin(actor.id, sellerOrderId);
}

/**
 * Web-only convenience wrapper: the seller's individual order page exposes
 * this as a single "Mark packed & ready for pickup" button instead of two
 * separate steps — collapses the existing markPacked + schedulePickup calls
 * into one action. Neither underlying function is changed, so the seller
 * mobile app (apps/web/src/app/api/mobile/v1/seller/orders/[id]/status/route.ts),
 * which still calls them as two separate PACK/SCHEDULE_PICKUP actions, is
 * unaffected.
 */
export async function markPackedAndReadyForPickup(
  sellerId: string,
  actorUserId: string,
  input: MarkPackedInput,
): Promise<WorkflowResult> {
  const packed = await markPacked(sellerId, actorUserId, input);
  if (!packed.ok) return packed;
  return schedulePickup(sellerId, actorUserId, { sellerOrderId: input.sellerOrderId });
}

export type MockLogisticsEvent = "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "DELIVERY_FAILED";

/**
 * Superset of MockLogisticsEvent — the real-carrier-only RTO statuses
 * (Delhivery/RapidShyp tracking, never the mock provider, which has no
 * concept of RTO) share the same Shipment + OrderStatusHistory writing
 * path as the mock events below, via applyShipmentStatusTransition /
 * advanceShipmentToStatus.
 */
export type ShipmentTransitionEvent =
  | MockLogisticsEvent
  | "RTO_INITIATED"
  | "RTO_DELIVERED_TO_SELLER";

const NOTIFICATION_FOR_EVENT: Record<
  ShipmentTransitionEvent,
  { title: string; body: (orderNumber: string, reason?: string) => string }
> = {
  PICKED_UP: { title: "Order picked up", body: (n) => `Your order ${n} has been picked up.` },
  IN_TRANSIT: { title: "Order in transit", body: (n) => `Your order ${n} is in transit.` },
  DELIVERED: { title: "Order delivered", body: (n) => `Your order ${n} has been delivered.` },
  DELIVERY_FAILED: {
    title: "Delivery attempt failed",
    body: (n, reason) =>
      `A delivery attempt for order ${n} failed.${reason ? ` Reason: ${reason}` : ""}`,
  },
  RTO_INITIATED: {
    title: "Order returned to origin",
    body: (n) => `Order ${n} is being sent back to the seller (RTO) by the courier.`,
  },
  RTO_DELIVERED_TO_SELLER: {
    title: "Order returned to seller",
    body: (n) => `Order ${n} has been returned to the seller.`,
  },
};

class RejectedShipmentTransition extends Error {}

export type SellerOrderWithShipment = Prisma.SellerOrderGetPayload<{ include: { shipment: true } }>;

/**
 * The shared transactional core, decoupled from *how* the provider result
 * was obtained. Used by applyMockLogisticsEventForOrder below (mock
 * provider) and by packages/orders/src/rapidshyp-shipping.ts (real
 * RapidShyp tracking updates) — both need the identical Shipment +
 * ShipmentStatusHistory + SellerOrder.status + DELIVERED side-effects
 * bundle, just sourced from a different provider call.
 */
export async function applyShipmentStatusTransition(
  order: SellerOrderWithShipment,
  actor: { id: string; role: UserRole },
  targetStatus: ShipmentTransitionEvent,
  rawProviderResponse: Record<string, unknown>,
  reason?: string,
  /** RapidShyp-sourced calls only (rapidshyp-shipping.ts) — the raw courier code/description that drove this transition, so the ShipmentStatusHistory row carries both what we understood it as AND exactly what RapidShyp said, for the tracking flow chart. Undefined for every mock-provider call. */
  courierStatus?: { code?: string; desc?: string },
): Promise<WorkflowResult> {
  const shipmentId = order.shipment!.id;
  const source: TransitionSource = actor.role === "ADMIN" ? "ADMIN" : "LOGISTICS_PROVIDER";
  const result = await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: targetStatus } });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId,
        status: targetStatus,
        courierStatusCode: courierStatus?.code,
        courierStatusDesc: courierStatus?.desc,
        rawProviderResponse: rawProviderResponse as Prisma.InputJsonValue,
      },
    });
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      targetStatus,
      actor,
      source,
      reason,
    );
    if (transition.ok && targetStatus === "DELIVERED") {
      // Payment auto-collection + settlement rows + dealer loyalty points,
      // in the same transaction as the DELIVERED status write. Shared with
      // the generic admin status-override path — see delivered-side-effects.ts.
      await runDeliveredSideEffects(tx, order.id);
    }
    if (transition.ok && targetStatus === "RTO_INITIATED") {
      // Nothing further can be collected on delivery once the courier is
      // sending the shipment back — raise the same kind of whole-order
      // refund a cancellation gets, for whatever was already paid (wallet
      // and/or gateway/POS). Only ever fires once: a later
      // RTO_DELIVERED_TO_SELLER call for the same order is a distinct
      // targetStatus and skips this block entirely.
      const orderWithAllocations = await tx.sellerOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { paymentAllocations: { include: { payment: true } } },
      });
      await settleMoneyForRtoOrder(tx, orderWithAllocations, actor);
    }
    // A rejected OrderStatus transition must not leave the Shipment status
    // and history row above committed on their own — that left
    // Shipment.status and SellerOrder.status disagreeing. Roll it all back.
    if (!transition.ok) throw new RejectedShipmentTransition(transition.error);
    return transition;
  }).catch((error: unknown): WorkflowResult => {
    if (error instanceof RejectedShipmentTransition) return { ok: false, error: error.message };
    throw error;
  });

  if (result.ok) {
    const notification = NOTIFICATION_FOR_EVENT[targetStatus];
    await notifyBuyer({
      customerId: order.customerId,
      title: notification.title,
      body: notification.body(order.orderNumber, reason),
    });
    if (targetStatus === "RTO_INITIATED") {
      // Same auto-approve-then-let-the-order-page-decide flow as a POS
      // cancellation refund (see autoCompleteCancellationRefund's doc
      // comment) — an RTO is itself the "review", so this only ever
      // approves the PENDING request settleMoneyForRtoOrder just created
      // (or auto-completes it for a non-POS order the same way
      // cancellation does).
      await autoCompleteCancellationRefund(order.id, actor);
    }
  }
  return result;
}

/**
 * True when a courier sync is just re-reporting a state the order is already
 * in, for the statuses applied directly rather than walked through
 * FORWARD_SEQUENCE (DELIVERY_FAILED and the RTO pair). Every poll re-reports
 * these — applying them again used to write a fresh, identical
 * ShipmentStatusHistory row each time (158 "RETURN Accepted" rows in 3 days
 * on one RTO order) because the transition is only rejected AFTER the
 * history row is created.
 */
export function isRepeatOfCurrentShipmentStatus(
  orderStatus: OrderStatus,
  targetStatus: ShipmentTransitionEvent,
): boolean {
  return (
    (targetStatus === "DELIVERY_FAILED" ||
      targetStatus === "RTO_INITIATED" ||
      targetStatus === "RTO_DELIVERED_TO_SELLER") &&
    orderStatus === targetStatus
  );
}

export const FORWARD_SEQUENCE: OrderStatus[] = [
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
];

/**
 * Statuses an order only reaches after it was delivered — a courier that
 * still reports "delivered" (or any earlier forward code) for one of these
 * has nothing new to tell us.
 */
const PAST_DELIVERY_STATUSES = new Set<OrderStatus>([
  "DELIVERED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_REJECTED",
  "REPLACEMENT_APPROVED",
  "REPLACEMENT_DISPATCHED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "CLOSED",
]);

/**
 * Pure planner for advanceShipmentToStatus's forward walk: the statuses to
 * step through, in order, to get from `current` to the forward `target`
 * (a FORWARD_SEQUENCE member). Empty when the order is already at or past
 * it.
 *
 * DELIVERY_FAILED isn't on FORWARD_SEQUENCE. A courier reporting forward
 * progress after a failed attempt means it is re-attempting, so the order
 * goes back to IN_TRANSIT (DELIVERY_FAILED → IN_TRANSIT is an allowed
 * transition) and carries on to the target from there. Any other status off
 * the sequence (cancelled, RTO, not yet packed, ...) gets a readable error
 * instead of a walk from index -1, which used to start at PACKED — not a
 * ShipmentStatus, so the Shipment write crashed the admin order page
 * (K4U-20260911-6743-S1).
 */
export function planForwardShipmentSteps(
  current: OrderStatus,
  target: ShipmentTransitionEvent,
): { ok: true; steps: MockLogisticsEvent[] } | { ok: false; error: string } {
  const targetIndex = FORWARD_SEQUENCE.indexOf(target);
  if (targetIndex === -1) return { ok: false, error: `${target} is not a forward shipment status.` };
  if (PAST_DELIVERY_STATUSES.has(current)) return { ok: true, steps: [] };

  if (current === "DELIVERY_FAILED") {
    const inTransitIndex = FORWARD_SEQUENCE.indexOf("IN_TRANSIT");
    const steps = FORWARD_SEQUENCE.slice(inTransitIndex, Math.max(targetIndex, inTransitIndex) + 1);
    return { ok: true, steps: steps as MockLogisticsEvent[] };
  }

  const currentIndex = FORWARD_SEQUENCE.indexOf(current);
  if (currentIndex === -1)
    return {
      ok: false,
      error: `The courier reports ${target}, but this order is ${current}, so it can't be moved automatically. Update it manually.`,
    };
  const steps = FORWARD_SEQUENCE.slice(currentIndex + 1, targetIndex + 1);
  return { ok: true, steps: steps as MockLogisticsEvent[] };
}

/**
 * Walks a shipment forward through FORWARD_SEQUENCE to `targetStatus`,
 * auto-advancing through any intermediate status a courier tracking sync
 * skipped over (e.g. a first "in transit" report with no prior "picked
 * up" scan), so one sync can't get stuck on a transition the state
 * machine would reject as skipping a step. Shared by rapidshyp-shipping.ts
 * and delhivery-shipping.ts. DELIVERY_FAILED and the RTO_* statuses are
 * applied directly (none of them are on the linear forward-to-DELIVERED
 * path).
 */
export async function advanceShipmentToStatus(
  order: SellerOrderWithShipment,
  actor: { id: string; role: UserRole },
  targetStatus: ShipmentTransitionEvent,
  rawProviderResponse: Record<string, unknown>,
  reason?: string,
  /** The raw courier code/desc that drove this call — attached only to the final (target) step, never to an intermediate step auto-advanced through. */
  courierStatus?: { code?: string; desc?: string },
): Promise<WorkflowResult> {
  if (isRepeatOfCurrentShipmentStatus(order.status, targetStatus)) return { ok: true };
  if (
    targetStatus === "DELIVERY_FAILED" ||
    targetStatus === "RTO_INITIATED" ||
    targetStatus === "RTO_DELIVERED_TO_SELLER"
  ) {
    // The first report we see of a finished return can already be the final
    // scan (poller gap, or the order was still IN_TRANSIT) — the state
    // machine only allows RTO_DELIVERED_TO_SELLER from RTO_INITIATED, so
    // step through it rather than have the whole transition rejected.
    if (targetStatus === "RTO_DELIVERED_TO_SELLER" && order.status !== "RTO_INITIATED") {
      const initiated = await applyShipmentStatusTransition(
        order,
        actor,
        "RTO_INITIATED",
        rawProviderResponse,
        "Auto-advanced by courier tracking sync",
      );
      if (!initiated.ok) return initiated;
      order = { ...order, status: "RTO_INITIATED" };
    }
    return applyShipmentStatusTransition(
      order,
      actor,
      targetStatus,
      rawProviderResponse,
      reason,
      courierStatus,
    );
  }
  const plan = planForwardShipmentSteps(order.status, targetStatus);
  if (!plan.ok) return plan;

  let current = order;
  for (const [i, step] of plan.steps.entries()) {
    const isFinalStep = i === plan.steps.length - 1;
    const result = await applyShipmentStatusTransition(
      current,
      actor,
      step,
      rawProviderResponse,
      isFinalStep ? reason : "Auto-advanced by courier tracking sync",
      isFinalStep ? courierStatus : undefined,
    );
    if (!result.ok) return result;
    current = { ...current, status: step };
  }
  return { ok: true };
}

/**
 * Mock-provider wrapper around applyShipmentStatusTransition — decoupled
 * from *how* the order was looked up and *who* the actor is —
 * `applyMockLogisticsEvent` (seller-scoped) and
 * `applyMockLogisticsEventAsAdmin` (unscoped) below are both thin wrappers
 * around this. This is what lets admin reach the same shipment-aware
 * status update a seller gets (updates Shipment + ShipmentStatusHistory
 * together with SellerOrder.status), instead of falling back to the
 * generic admin status override (transitionSellerOrder), which only ever
 * writes SellerOrder.status and would leave Shipment silently stale.
 */
async function applyMockLogisticsEventForOrder(
  order: SellerOrderWithShipment,
  actor: { id: string; role: UserRole },
  targetStatus: MockLogisticsEvent,
  reason?: string,
): Promise<WorkflowResult> {
  if (!order.shipment?.awbNumber)
    return { ok: false, error: "No shipment has been created for this order yet." };

  const providerResult =
    targetStatus === "PICKED_UP"
      ? await mockLogisticsProvider.markPickedUp(order.shipment.awbNumber)
      : targetStatus === "IN_TRANSIT"
        ? await mockLogisticsProvider.markInTransit(order.shipment.awbNumber)
        : targetStatus === "DELIVERED"
          ? await mockLogisticsProvider.markDelivered(order.shipment.awbNumber)
          : await mockLogisticsProvider.markDeliveryFailed(order.shipment.awbNumber, reason);

  return applyShipmentStatusTransition(order, actor, targetStatus, providerResult.rawResponse, reason);
}

/** Ownership-scoped (seller): "not found" for an order that isn't this seller's own, matching every other seller-facing lookup in this file. */
async function applyMockLogisticsEvent(
  sellerId: string,
  actorUserId: string,
  sellerOrderId: string,
  targetStatus: MockLogisticsEvent,
  reason?: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, sellerId },
    include: { shipment: true },
  });
  if (!order) return { ok: false, error: "Order not found." };
  return applyMockLogisticsEventForOrder(
    order,
    { id: actorUserId, role: "SELLER" },
    targetStatus,
    reason,
  );
}

/** Unscoped (admin): admin may act on any seller's order — a stand-in for the delivery-partner API/webhook integration that doesn't exist yet. */
async function applyMockLogisticsEventAsAdmin(
  adminUserId: string,
  sellerOrderId: string,
  targetStatus: MockLogisticsEvent,
  reason?: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId },
    include: { shipment: true },
  });
  if (!order) return { ok: false, error: "Order not found." };
  return applyMockLogisticsEventForOrder(
    order,
    { id: adminUserId, role: "ADMIN" },
    targetStatus,
    reason,
  );
}

export const markPickedUp = (sellerId: string, actorUserId: string, sellerOrderId: string) =>
  applyMockLogisticsEvent(sellerId, actorUserId, sellerOrderId, "PICKED_UP");
export const markInTransit = (sellerId: string, actorUserId: string, sellerOrderId: string) =>
  applyMockLogisticsEvent(sellerId, actorUserId, sellerOrderId, "IN_TRANSIT");
export const markDelivered = (sellerId: string, actorUserId: string, sellerOrderId: string) =>
  applyMockLogisticsEvent(sellerId, actorUserId, sellerOrderId, "DELIVERED");
export const markDeliveryFailed = (
  sellerId: string,
  actorUserId: string,
  sellerOrderId: string,
  reason: string,
) => applyMockLogisticsEvent(sellerId, actorUserId, sellerOrderId, "DELIVERY_FAILED", reason);

// --- Admin logistics actions (§A4 of the plan) ------------------------------
// Seller keeps PICKED_UP (markPickedUp above, unchanged) — these three cover
// everything from IN_TRANSIT onward, which per product decision is now
// admin-only on the dashboard's seller order page (the underlying SELLER
// capability above is left intact for the seller mobile app, which is out
// of scope for this change).

export const adminMarkInTransit = (adminUserId: string, sellerOrderId: string) =>
  applyMockLogisticsEventAsAdmin(adminUserId, sellerOrderId, "IN_TRANSIT");
export const adminMarkDelivered = (adminUserId: string, sellerOrderId: string) =>
  applyMockLogisticsEventAsAdmin(adminUserId, sellerOrderId, "DELIVERED");
export const adminMarkDeliveryFailed = (
  adminUserId: string,
  sellerOrderId: string,
  reason: string,
) => applyMockLogisticsEventAsAdmin(adminUserId, sellerOrderId, "DELIVERY_FAILED", reason);
