import { prisma, type OrderStatus, type UserRole } from "@kisan4u/db";
import { writeAuditLog } from "./audit";
import { runDeliveredSideEffects } from "./delivered-side-effects";
import { cancelCourierShipmentForOrder } from "./courier-cancel";

export type TransitionSource =
  "CUSTOMER" | "SELLER" | "ADMIN" | "PAYMENT_PROVIDER" | "LOGISTICS_PROVIDER" | "SYSTEM";
export type TransitionActor = { id: string; role: UserRole };
export type TransitionResult = { ok: true } | { ok: false; error: string };

type Rule = { to: OrderStatus; allowedRoles: UserRole[] };

/**
 * The central, server-only authority for order-status transitions (Phase
 * 4 spec §L1 — "do not allow arbitrary status editing"). Every status
 * change in the app, whether triggered by a customer, seller, admin, the
 * mock payment provider, or the mock logistics provider, goes through
 * `canTransition`/`recordStatusChange` below — there is no other code path
 * that writes SellerOrder.status. Only the Phase 4 subset of the full
 * future OrderStatus enum has real transitions wired; every replacement
 * value is reserved and unreachable this phase (return/refund and RTO_*
 * are wired — see DELIVERED and IN_TRANSIT's rules below).
 */
const TRANSITIONS: Record<OrderStatus, Rule[]> = {
  PENDING_PAYMENT: [
    // CONFIRMED is now a deliberate, human step: Kisan4U's scheduling team
    // calls the customer to confirm the order, then an admin confirms it
    // here (order-workflow.ts's confirmOrder). Payment succeeding no longer
    // auto-advances the order — every order, regardless of payer or payment
    // method, sits at PENDING_PAYMENT ("Pending") until that call happens.
    // Stock is deducted at this transition, not before.
    { to: "CONFIRMED", allowedRoles: ["ADMIN"] },
    // Still driven by the payment provider path (partial advance received);
    // actor there is the customer/dealer whose payment it is.
    { to: "PAYMENT_PARTIALLY_RECEIVED", allowedRoles: ["CUSTOMER", "DEALER", "ADMIN", "STAFF"] },
    // A just-placed order sits at PENDING until the scheduling team's
    // confirm call — nothing has happened yet (no stock deducted, seller
    // hasn't seen it), so the buyer can cancel it themselves outright
    // rather than filing a request for an admin to approve
    // (cancellation.ts's cancelPendingOrderByCustomer). Once CONFIRMED,
    // cancellation reverts to the request → admin-approve flow.
    { to: "CANCELLED", allowedRoles: ["ADMIN", "CUSTOMER", "DEALER"] },
  ],
  PAYMENT_PARTIALLY_RECEIVED: [
    { to: "CONFIRMED", allowedRoles: ["ADMIN"] },
    { to: "CANCELLED", allowedRoles: ["ADMIN", "CUSTOMER", "DEALER"] },
  ],
  CONFIRMED: [
    { to: "SELLER_ACCEPTED", allowedRoles: ["SELLER", "ADMIN"] },
    // SELLER is included here (pre-acceptance only, §O1 seller rejection)
    // in addition to the customer-initiated cancellation request (§M).
    { to: "CANCELLATION_REQUESTED", allowedRoles: ["CUSTOMER", "DEALER", "SELLER"] },
    { to: "CANCELLED", allowedRoles: ["ADMIN"] },
    // Back to square one — see revertConfirmedOrderToPending
    // (order-workflow.ts), the only caller: it restores the stock
    // deducted at CONFIRMED in the same transaction as this transition,
    // for the case where a logistics issue (no serviceable pickup point,
    // address problem, etc.) blocks scheduling and the order needs to go
    // back to the scheduling team rather than sit stuck.
    { to: "PENDING_PAYMENT", allowedRoles: ["ADMIN"] },
  ],
  SELLER_ACCEPTED: [
    { to: "PACKED", allowedRoles: ["SELLER", "ADMIN"] },
    { to: "CANCELLATION_REQUESTED", allowedRoles: ["CUSTOMER", "DEALER"] },
    { to: "CANCELLED", allowedRoles: ["ADMIN"] },
    { to: "PENDING_PAYMENT", allowedRoles: ["ADMIN"] },
  ],
  PACKED: [
    { to: "PICKUP_SCHEDULED", allowedRoles: ["SELLER", "ADMIN"] },
    { to: "CANCELLATION_REQUESTED", allowedRoles: ["CUSTOMER", "DEALER"] },
    { to: "CANCELLED", allowedRoles: ["ADMIN"] },
    { to: "PENDING_PAYMENT", allowedRoles: ["ADMIN"] },
  ],
  PICKUP_SCHEDULED: [
    { to: "PICKED_UP", allowedRoles: ["SELLER", "ADMIN"] },
    { to: "CANCELLATION_REQUESTED", allowedRoles: ["CUSTOMER", "DEALER"] },
    { to: "CANCELLED", allowedRoles: ["ADMIN"] },
  ],
  // Cancellation is blocked from PICKED_UP onward — IN_TRANSIT is the
  // spec's stated cutoff (§M), and PICKED_UP is the step immediately
  // before it, so no CANCELLATION_REQUESTED rule appears here either.
  PICKED_UP: [{ to: "IN_TRANSIT", allowedRoles: ["SELLER", "ADMIN"] }],
  IN_TRANSIT: [
    { to: "DELIVERED", allowedRoles: ["SELLER", "ADMIN"] },
    { to: "DELIVERY_FAILED", allowedRoles: ["SELLER", "ADMIN"] },
    // Carrier-driven only (Delhivery/RapidShyp tracking poller, actor
    // role ADMIN — see delhivery.ts/rapidshyp.ts's FORWARD_STATUS_MAP) —
    // the courier decided to send the shipment back to the seller instead
    // of completing delivery.
    { to: "RTO_INITIATED", allowedRoles: ["SELLER", "ADMIN"] },
  ],
  DELIVERY_FAILED: [
    { to: "IN_TRANSIT", allowedRoles: ["SELLER", "ADMIN"] },
    { to: "CANCELLED", allowedRoles: ["ADMIN"] },
    // Carrier-driven, same as from IN_TRANSIT — after a failed attempt the
    // courier commonly gives up and sends the parcel back to the seller.
    { to: "RTO_INITIATED", allowedRoles: ["SELLER", "ADMIN"] },
  ],
  // Reject-cancellation targets are enumerated explicitly (not a generic
  // "go back to whatever it was") — cancellation.ts picks the correct one
  // of these based on the order's own history, but the transition service
  // is still the thing that ultimately permits or blocks it.
  CANCELLATION_REQUESTED: [
    { to: "CANCELLED", allowedRoles: ["ADMIN"] },
    { to: "CONFIRMED", allowedRoles: ["ADMIN"] },
    { to: "SELLER_ACCEPTED", allowedRoles: ["ADMIN"] },
    { to: "PACKED", allowedRoles: ["ADMIN"] },
    { to: "PICKUP_SCHEDULED", allowedRoles: ["ADMIN"] },
  ],
  // Return/refund (packages/orders/src/refunds.ts) — the customer-facing
  // counterpart to CANCELLATION_REQUESTED above, but only reachable AFTER
  // delivery (cancellation's own transition map stops permitting it from
  // PICKED_UP onward). Only the refund half of the schema's return/
  // replacement/refund/RTO subset is wired this phase — REPLACEMENT_*
  // stays reserved/unreachable, same as RTO_*/CLOSED always have been.
  DELIVERED: [{ to: "RETURN_REQUESTED", allowedRoles: ["CUSTOMER", "DEALER"] }],
  CANCELLED: [],
  RETURN_REQUESTED: [
    { to: "RETURN_APPROVED", allowedRoles: ["ADMIN"] },
    { to: "RETURN_REJECTED", allowedRoles: ["ADMIN"] },
  ],
  RETURN_APPROVED: [{ to: "REFUND_INITIATED", allowedRoles: ["ADMIN"] }],
  // Terminal — a rejected return isn't reverted back to DELIVERED (unlike
  // a rejected cancellation, which reverts): the order genuinely was
  // delivered and stays delivered, this just records that no refund
  // followed. RefundRequest.status REJECTED is the record of why.
  RETURN_REJECTED: [],
  REPLACEMENT_APPROVED: [],
  REPLACEMENT_DISPATCHED: [],
  REFUND_INITIATED: [{ to: "REFUND_COMPLETED", allowedRoles: ["ADMIN"] }],
  REFUND_COMPLETED: [],
  // RTO_DELIVERED_TO_SELLER: Delhivery's final "RTO"/StatusType "DL" scan
  // ("RETURN Accepted") drives it automatically (see
  // resolveDelhiveryShipmentStatus); RapidShyp's RTO_DEL ("RTO Delivered")
  // drives it the same way (resolveRapidShypForwardStatus).
  RTO_INITIATED: [{ to: "RTO_DELIVERED_TO_SELLER", allowedRoles: ["SELLER", "ADMIN"] }],
  RTO_DELIVERED_TO_SELLER: [],
  CLOSED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actorRole: UserRole): boolean {
  return (TRANSITIONS[from] ?? []).some(
    (rule) => rule.to === to && rule.allowedRoles.includes(actorRole),
  );
}

/**
 * Every status from SELLER_ACCEPTED onward assumes SellerOrder.pickupPointId
 * is already set — acceptOrder is the only place that ever sets it. Real
 * incident (2026-08-22, 2026-08-24): transitionSellerOrder's generic admin
 * override let an order reach SELLER_ACCEPTED/PACKED with no pickup point
 * ever attached, silently breaking schedulePickup downstream. Guarded here
 * instead of in recordStatusChange, since transitionSellerOrder is the one
 * and only path that can reach these statuses without going through
 * acceptOrder/markPacked/schedulePickup's own pickup-point handling.
 */
const STATUSES_REQUIRING_PICKUP_POINT: OrderStatus[] = [
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "DELIVERY_FAILED",
];

/**
 * The forward "getting it to the customer" statuses. Once an order is
 * CONFIRMED it must be handed to a logistics partner (the Create Shipment
 * wizard, or the mock "pack & schedule" action) — it can NOT be walked
 * through these by hand via the generic admin status dropdown
 * (transitionSellerOrder). After that:
 *   - RapidShyp / Delhivery shipment  -> fully API-driven. The generic
 *     override is refused for every one of these; status moves only from
 *     the tracking poller / "Refresh status" / cancellation.
 *   - Mock shipment (provider "MOCK") -> the manual/simulated path; the
 *     generic override still works, same as before.
 *   - deliveryMethod TRANSPORT        -> no courier API exists for a
 *     transport partner, so the whole guard is skipped (manual, like mock).
 */
export const LOGISTICS_LIFECYCLE_STATUSES: OrderStatus[] = STATUSES_REQUIRING_PICKUP_POINT;

const REAL_LOGISTICS_PROVIDERS = new Set(["RAPIDSHYP", "DELHIVERY"]);

export function logisticsProviderLabel(provider: string): string {
  if (provider === "RAPIDSHYP") return "RapidShyp";
  if (provider === "DELHIVERY") return "Delhivery";
  return provider;
}

/**
 * Whether the generic admin status dropdown may NOT move this order
 * through the fulfilment pipeline (LOGISTICS_LIFECYCLE_STATUSES). True
 * when the order isn't a manual-only case (TRANSPORT delivery, or a mock
 * shipment): i.e. it has no shipment yet (must be dispatched first) or is
 * with a real courier (RapidShyp/Delhivery drive status via tracking).
 * The single source of truth shared by transitionSellerOrder's server
 * guard and the dashboard's dropdown-option filter.
 */
export function isLogisticsStatusLocked(input: {
  deliveryMethod: string;
  shipmentProvider: string | null;
}): boolean {
  if (input.deliveryMethod === "TRANSPORT") return false;
  if (input.shipmentProvider == null) return true;
  return REAL_LOGISTICS_PROVIDERS.has(input.shipmentProvider);
}

type HistoryTxClient = Pick<typeof prisma, "sellerOrder" | "orderStatusHistory">;

/**
 * Low-level, transaction-safe primitive — validates the transition,
 * updates SellerOrder.status, and appends one (never overwritten,
 * Phase 4 spec §L1) OrderStatusHistory row. Meant to be called from
 * WITHIN an existing `prisma.$transaction` callback by higher-level
 * order-workflow functions that also need to write other rows atomically
 * alongside the status change (e.g. setting pickupPointId on accept).
 */
export async function recordStatusChange(
  tx: HistoryTxClient,
  sellerOrderId: string,
  currentStatus: OrderStatus,
  targetStatus: OrderStatus,
  actor: TransitionActor,
  source: TransitionSource,
  note?: string,
): Promise<TransitionResult> {
  if (!canTransition(currentStatus, targetStatus, actor.role)) {
    return { ok: false, error: `This order cannot move from ${currentStatus} to ${targetStatus}.` };
  }
  await tx.sellerOrder.update({ where: { id: sellerOrderId }, data: { status: targetStatus } });
  await tx.orderStatusHistory.create({
    data: {
      sellerOrderId,
      status: targetStatus,
      actorId: actor.id,
      actorRole: actor.role,
      source,
      note,
    },
  });
  return { ok: true };
}

/**
 * Public convenience wrapper for transitions that need no other side
 * effects (mock logistics status updates, admin manual override) — opens
 * its own transaction and writes an audit-log entry.
 */
export async function transitionSellerOrder(
  sellerOrderId: string,
  targetStatus: OrderStatus,
  actor: TransitionActor,
  source: TransitionSource,
  note?: string,
): Promise<TransitionResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    select: {
      status: true,
      pickupPointId: true,
      deliveryMethod: true,
      shipment: { select: { provider: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };

  // A transport-partner order has no courier API to take over, so it stays
  // fully manual (same as a mock shipment). Every other order must be
  // dispatched to a logistics partner before it can move through the
  // fulfilment pipeline, and a real-partner shipment is then untouchable
  // by hand.
  const provider = order.shipment?.provider ?? null;
  if (
    LOGISTICS_LIFECYCLE_STATUSES.includes(targetStatus) &&
    isLogisticsStatusLocked({ deliveryMethod: order.deliveryMethod, shipmentProvider: provider })
  ) {
    if (!provider) {
      return {
        ok: false,
        error:
          "Dispatch this order to a logistics partner first (Create Shipment). Its status can't be walked through the fulfilment pipeline by hand.",
      };
    }
    return {
      ok: false,
      error: `This order is with ${logisticsProviderLabel(provider)} — its status updates automatically from their tracking. Use "Refresh status" to pull the latest.`,
    };
  }

  if (STATUSES_REQUIRING_PICKUP_POINT.includes(targetStatus) && !order.pickupPointId) {
    return {
      ok: false,
      error:
        "This order has no pickup point set. Have the seller accept the order with a pickup point (or use the seller's \"Schedule pickup\" pickup-point picker) instead of moving it here directly.",
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      sellerOrderId,
      order.status,
      targetStatus,
      actor,
      source,
      note,
    );
    // The generic admin override is the one way an order can reach
    // DELIVERED without going through applyShipmentStatusTransition (no
    // shipment/AWB). It must still run the same delivered-side effects —
    // auto-collect the outstanding balance, create settlement rows, award
    // loyalty points — or the balance stays uncollected and no settlement
    // appears. Idempotent, so reaching this twice is safe.
    if (transition.ok && targetStatus === "DELIVERED") {
      await runDeliveredSideEffects(tx, sellerOrderId);
    }
    return transition;
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "ORDER_STATUS_CHANGE",
      entityType: "SellerOrder",
      entityId: sellerOrderId,
      metadata: { from: order.status, to: targetStatus, source },
      reason: note,
    });
    // A manual admin override straight to CANCELLED still needs the courier
    // told (RapidShyp / Delhivery) — same as decideCancellation's approve
    // path. Best-effort; recorded on the shipment tracking history + audit.
    if (targetStatus === "CANCELLED") {
      await cancelCourierShipmentForOrder(sellerOrderId, actor);
    }
  }
  return result;
}
