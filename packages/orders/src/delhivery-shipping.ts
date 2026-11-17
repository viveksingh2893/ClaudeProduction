import { prisma, Prisma, type UserRole } from "@kisan4u/db";
import {
  delhiveryCheckServiceability,
  delhiveryCreateShipment,
  delhiveryCreateReverseShipment,
  delhiveryGenerateLabel,
  delhiveryTrackShipment,
  resolveDelhiveryShipmentStatus,
  type DelhiveryAccountKey,
} from "@kisan4u/providers";
import type { SendToDelhiveryInput, SendReturnToDelhiveryInput } from "@kisan4u/validators";
import { recordStatusChange } from "./status-transitions";
import { writeAuditLog } from "./audit";
import { notifyBuyer } from "./notifications";
import { round2 } from "./money";
import { estimateReturnPackageForItem } from "./return-package";
import { ensureDelhiveryWarehouse } from "./courier-pickup-sync";
import {
  advanceShipmentToStatus,
  isRepeatOfCurrentShipmentStatus,
  markPacked,
  markPackedAsAdmin,
  type SellerOrderWithShipment,
  type WorkflowResult,
} from "./order-workflow";

/**
 * Delhivery dispatch — the direct-single-carrier counterpart to
 * rapidshyp-shipping.ts. Delhivery is one carrier, so this is
 * substantially simpler than the RapidShyp flow: a single
 * `cmu/create.json` manifests the shipment AND returns the waybill (no
 * approve / assign-AWB / courier-selection dance), then one call fetches
 * the label. Pickup is left to account-level auto-pickup on Delhivery's
 * side (see delhivery.ts's module doc).
 *
 * Every seller pickup point is registered as its own Delhivery client
 * warehouse (name `K4U-<pickupPointId>`, `-r<n>` after an address change)
 * when an admin approves it (see courier-pickup-sync.ts) — or lazily here
 * on first dispatch if that missed.
 */

const DELHIVERY_ORDER_INCLUDE = {
  items: true,
  shipment: true,
  charge: true,
  pickupPoint: true,
  seller: { select: { shopName: true } },
  checkoutGroup: { include: { addressSnapshot: true } },
  paymentAllocations: { include: { payment: true } },
} as const;

/**
 * Push of a PACKED order to Delhivery. Callable by admin (unscoped) or the
 * seller (`scope: { sellerId }`) — same ownership split as
 * sendSellerOrderToRapidShyp. Package dimensions and weight aren't stored
 * anywhere upstream, so they come fresh from the caller's form
 * (sendToRapidShypInputSchema — reused, identical shape).
 */
export async function sendSellerOrderToDelhivery(
  actor: { id: string; role: UserRole },
  input: SendToDelhiveryInput,
  scope?: { sellerId: string },
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, ...(scope ? { sellerId: scope.sellerId } : {}) },
    include: DELHIVERY_ORDER_INCLUDE,
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "PACKED")
    return { ok: false, error: "Only a packed order can be sent to Delhivery." };
  if (order.shipment) return { ok: false, error: "A shipment already exists for this order." };
  if (order.deliveryMethod !== "KISAN4U_COURIER")
    return {
      ok: false,
      error: "This order uses a transport partner, not courier delivery — Delhivery doesn't apply.",
    };
  const address = order.checkoutGroup.addressSnapshot;
  if (!address) return { ok: false, error: "This order has no delivery address on file." };
  const pickupPoint = order.pickupPoint;
  if (!pickupPoint) return { ok: false, error: "This order has no pickup point assigned yet." };

  const account = input.delhiveryAccount;

  // Register (idempotent) this pickup point's warehouse on the SELECTED
  // account before use — a warehouse registered on one Delhivery account
  // isn't known to the others, so this runs every dispatch, not just when
  // delhiveryWarehouseName is unset.
  const registered = await ensureDelhiveryWarehouse(account, pickupPoint, {
    useKnownNameOnFailure: true,
  });
  if (!registered.ok)
    return {
      ok: false,
      error: `Delhivery: could not register this pickup point on the selected account (${registered.error}).`,
    };
  const warehouseName = registered.name;

  const serviceability = await delhiveryCheckServiceability(account, address.pincode);
  if (!serviceability.ok)
    return { ok: false, error: `Delhivery: ${serviceability.error}` };
  if (!serviceability.data.serviceable)
    return {
      ok: false,
      error: `Delhivery does not currently service ${address.pincode} (${serviceability.data.remarks}).`,
    };

  // Two distinct amounts go to Delhivery and they are NOT the same for a
  // partial-prepaid order:
  //   total_amount → the shipment's declared invoice value (what the goods
  //     are worth — drives the invoice, the e-waybill >50k threshold, and
  //     the loss/damage claim basis). Always the FULL order value, delivery
  //     charge included — Delhivery is collecting that charge on our behalf,
  //     so it's part of what the parcel is insured for.
  //   cod_amount   → what the courier actually collects on delivery. For
  //     ONLINE_PARTIAL that's the full value minus whatever was already
  //     collected online; for plain COD it equals total_amount; for a
  //     prepaid order it's 0.
  // The delivery charge used to be subtracted out of both figures (treating
  // it as collected separately from the courier), which meant Delhivery was
  // never asked to collect it — a real shortfall, caught on order
  // K4U-20260914-2292-S1 (2026-09-15): admin panel showed customerPayableTotal
  // 5441.33 but Delhivery's cod_amount was only 3161.58, short by exactly the
  // ₹280 delivery charge. There's no separate collection path for delivery,
  // so it belongs in the one COD figure sent to Delhivery — no bifurcation.
  //
  // Before that, both figures were sent as the reduced (net − prepaid)
  // figure, which under-declared the parcel: a lost/damaged partial-prepaid
  // shipment was only insured for the COD leg, not COD + prepaid. Delhivery
  // accepts total_amount > cod_amount by design (it's already how a
  // fully-prepaid order is sent: non-zero total_amount, blank cod_amount).
  //
  // OrderItem values are always GROSS; OrderCharge.customerPayableTotal is
  // the real billed amount (merchandise + tax + delivery) net of a
  // Kisan4u-borne discount.
  const amountAlreadyPaid = order.paymentAllocations.reduce(
    (total, allocation) =>
      total +
      Number(allocation.amount) *
        (Number(allocation.payment.amountPaid) / Number(allocation.payment.totalAmount || 1)) +
      Number(allocation.remainingCollectedAmount),
    0,
  );
  const grossMerchandiseAndTax = Number(order.subtotal) + Number(order.taxAmount);
  const fullOrderValue = order.charge
    ? Number(order.charge.customerPayableTotal)
    : grossMerchandiseAndTax;
  // What the courier still has to collect on delivery. A COD order can be
  // part- (or fully) paid from the buyer's wallet at checkout, so COD nets
  // off what's already paid exactly like ONLINE_PARTIAL does — for a plain
  // COD order amountAlreadyPaid is 0 and nothing changes.
  const codCollectableAmount =
    order.paymentMethod === "ONLINE_PARTIAL" || order.paymentMethod === "COD"
      ? Math.max(0, round2(fullOrderValue - amountAlreadyPaid))
      : fullOrderValue;

  // A COD or partial-prepaid order the wallet covered in full (the wallet
  // comes off the whole total first, so it can cover a partial order too)
  // has nothing to collect — ship it as Prepaid rather than as COD with a
  // zero amount.
  const paymentMode: "COD" | "Prepaid" =
    order.paymentMethod === "ONLINE_FULL" ||
    order.paymentMethod === "WALLET" ||
    ((order.paymentMethod === "COD" || order.paymentMethod === "ONLINE_PARTIAL") &&
      codCollectableAmount <= 0)
      ? "Prepaid"
      : "COD";

  const productsDesc =
    order.items
      .map((item) => item.productName)
      .join(", ")
      .slice(0, 200) || "Agri inputs";
  const consigneeAddress =
    [address.line1, address.line2, address.landmark].filter(Boolean).join(", ") || address.line1;

  const request = {
    orderNumber: order.orderNumber,
    pickupWarehouseName: warehouseName,
    paymentMode,
    codAmount: paymentMode === "COD" ? round2(codCollectableAmount) : 0,
    totalAmount: round2(fullOrderValue),
    consigneeName: address.fullName,
    consigneePhone: address.mobile,
    consigneeAddress,
    consigneePincode: address.pincode,
    consigneeCity: address.cityTown,
    consigneeState: address.state,
    productsDesc,
    weightGrams: input.packageWeightGrams,
    lengthCm: input.packageLengthCm,
    breadthCm: input.packageBreadthCm,
    heightCm: input.packageHeightCm,
    sellerName: order.seller.shopName,
  };
  const created = await delhiveryCreateShipment(account, request);
  if (!created.ok) return { ok: false, error: `Delhivery: ${created.error}` };

  // Non-fatal — the shipment exists on Delhivery with a waybill regardless;
  // pollActiveDelhiveryShipments backfills the label if this fails.
  const label = await delhiveryGenerateLabel(account, created.data.waybill);

  const result = await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        sellerOrderId: order.id,
        pickupPointSnapshot: { delhiveryWarehouseName: warehouseName, name: pickupPoint.name },
        provider: "DELHIVERY",
        delhiveryAccount: account,
        awbNumber: created.data.waybill,
        courierName: "Delhivery",
        trackingStatusDesc: created.data.status,
        labelUrl: label.ok ? label.data.labelUrl : null,
        labelFetchedAt: label.ok ? new Date() : null,
        status: "PICKUP_SCHEDULED",
        lastSyncedAt: new Date(),
      },
    });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "PICKUP_SCHEDULED",
        // `request` (declared weight/dimensions) is logged alongside the
        // response so a mismatch between what was declared and what the
        // provider's dashboard shows later can be traced to our actual
        // outbound payload instead of inferred after the fact — see the
        // K4U-20260915-9488-S1 dimension-mismatch investigation.
        rawProviderResponse: {
          request,
          created: created.raw,
          label: label.raw ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    return recordStatusChange(
      tx,
      order.id,
      order.status,
      "PICKUP_SCHEDULED",
      actor,
      "LOGISTICS_PROVIDER",
      `Sent to Delhivery (waybill ${created.data.waybill})`,
    );
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "DELHIVERY_SHIPMENT_CREATED",
      entityType: "SellerOrder",
      entityId: order.id,
      metadata: { waybill: created.data.waybill },
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order packed and ready for pickup",
      body: `Your order ${order.orderNumber} has been packed and is ready for pickup.`,
    });
  }
  return result;
}

/**
 * "Pack & send to Delhivery" — the explicit Delhivery choice, offered
 * alongside packAndSendToRapidShyp / packAndScheduleMockPickup. Packs
 * first (if not already packed) then dispatches, as one call.
 */
export async function packAndSendToDelhivery(
  actor: { id: string; role: UserRole },
  input: SendToDelhiveryInput,
  scope?: { sellerId: string },
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, ...(scope ? { sellerId: scope.sellerId } : {}) },
    select: { status: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  if (order.status === "SELLER_ACCEPTED") {
    const packed = scope
      ? await markPacked(scope.sellerId, actor.id, { sellerOrderId: input.sellerOrderId })
      : await markPackedAsAdmin(actor.id, input.sellerOrderId);
    if (!packed.ok) return packed;
  } else if (order.status !== "PACKED") {
    return { ok: false, error: `Cannot dispatch an order at ${order.status} to Delhivery.` };
  }

  return sendSellerOrderToDelhivery(actor, input, scope);
}

const DELHIVERY_POLLER_ACTOR_ID = "system:delhivery-tracking-poller";

/**
 * Admin-triggered (or poller-triggered) pull of live status from Delhivery
 * for an order already dispatched there. Always refreshes the label (if
 * missing) + display fields; only attempts an OrderStatus transition for
 * Delhivery's forward-progress statuses (DELHIVERY_FORWARD_STATUS_MAP).
 */
export async function refreshDelhiveryTrackingStatus(
  actorUserId: string,
  sellerOrderId: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId },
    include: { shipment: true },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.shipment || order.shipment.provider !== "DELHIVERY" || !order.shipment.awbNumber)
    return { ok: false, error: "This order has no Delhivery shipment to refresh." };

  const account = (order.shipment.delhiveryAccount ?? "MARKETING1") as DelhiveryAccountKey;

  // Backfill the label if dispatch-time generate failed.
  if (!order.shipment.labelUrl) {
    const label = await delhiveryGenerateLabel(account, order.shipment.awbNumber);
    if (label.ok) {
      await prisma.shipment.update({
        where: { id: order.shipment.id },
        data: { labelUrl: label.data.labelUrl, labelFetchedAt: new Date() },
      });
    }
  }

  const tracked = await delhiveryTrackShipment(account, order.shipment.awbNumber);
  if (!tracked.ok) {
    // Normal between manifestation and the first scan — not an error worth
    // surfacing on a manual refresh (matches the RapidShyp poller).
    if (tracked.error.includes("Tracking data not found")) {
      await prisma.shipment.update({
        where: { id: order.shipment.id },
        data: { lastSyncedAt: new Date() },
      });
      return { ok: true };
    }
    return { ok: false, error: `Delhivery: ${tracked.error}` };
  }

  const newStatus = tracked.data.status;
  const statusChanged = !!newStatus && newStatus !== order.shipment.trackingStatusCode;

  await prisma.shipment.update({
    where: { id: order.shipment.id },
    data: {
      trackingStatusCode: newStatus ?? order.shipment.trackingStatusCode,
      trackingStatusDesc: tracked.data.statusDesc ?? order.shipment.trackingStatusDesc,
      lastSyncedAt: new Date(),
    },
  });

  const forwardStatus = resolveDelhiveryShipmentStatus(newStatus, tracked.data.statusType);
  // A repeat poll of an RTO / failed-delivery state the order is already in
  // is not a new event — no transition, no history row (that used to add
  // an identical "RETURN Accepted" row every 20 minutes). It falls through
  // to the informational row below, which only fires if the courier's
  // status genuinely moved.
  if (forwardStatus && !isRepeatOfCurrentShipmentStatus(order.status, forwardStatus)) {
    return advanceShipmentToStatus(
      order as SellerOrderWithShipment,
      { id: actorUserId, role: "ADMIN" },
      forwardStatus,
      tracked.raw as Record<string, unknown>,
      tracked.data.statusDesc,
      { code: newStatus, desc: tracked.data.statusDesc },
    );
  }

  // A code Delhivery reported (RTO / return / anything non-forward) that
  // doesn't drive a transition — still recorded so the tracking history is
  // complete, same discipline as refreshRapidShypTrackingStatus.
  if (statusChanged) {
    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: order.shipment.id,
        status: null,
        courierStatusCode: newStatus,
        courierStatusDesc: tracked.data.statusDesc,
        rawProviderResponse: tracked.raw as Prisma.InputJsonValue,
      },
    });
  }

  return { ok: true };
}

export interface DelhiveryPollSummary {
  checked: number;
  succeeded: number;
  errors: { sellerOrderId: string; error: string }[];
}

/**
 * Bulk counterpart to refreshDelhiveryTrackingStatus for every in-flight
 * Delhivery shipment — called on a timer (instrumentation-node.ts).
 * "Tracking data not found" is expected before the first courier scan and
 * treated as a normal no-op, same as the RapidShyp poller.
 */
export async function pollActiveDelhiveryShipments(): Promise<DelhiveryPollSummary> {
  const shipments = await prisma.shipment.findMany({
    where: {
      provider: "DELHIVERY",
      // DELIVERY_FAILED stays polled: a failed attempt is usually
      // re-attempted, then delivered or sent back (RTO).
      status: { notIn: ["DELIVERED", "RTO_DELIVERED_TO_SELLER"] },
    },
    select: { sellerOrderId: true },
  });

  const summary: DelhiveryPollSummary = { checked: 0, succeeded: 0, errors: [] };
  for (const { sellerOrderId } of shipments) {
    summary.checked += 1;
    const result = await refreshDelhiveryTrackingStatus(DELHIVERY_POLLER_ACTOR_ID, sellerOrderId);
    if (result.ok) {
      summary.succeeded += 1;
    } else if (!result.error.includes("Tracking data not found")) {
      summary.errors.push({ sellerOrderId, error: result.error });
    }
  }
  return summary;
}

// --- Reverse pickup (return to sender) --------------------------------

export type SendReturnToDelhiveryResult = { ok: true } | { ok: false; error: string };

/**
 * Books a Delhivery reverse pickup for an APPROVED per-item return whose
 * ORIGINAL shipment went via Delhivery — the mirror of
 * rapidshyp-return.ts's sendReturnToRapidShyp. Called automatically when an
 * admin approves the return (refunds.ts's decideReturnRequest) and, as a
 * retry, from the admin order page. Package size is estimated from the
 * returned item when the caller doesn't pass exact figures.
 *
 * Direction is reversed from the forward shipment: Delhivery picks up FROM
 * the customer's delivery address and returns the parcel TO the seller's
 * Delhivery warehouse (K4U-<pickupPointId>, registered on demand).
 */
export async function sendReturnToDelhivery(
  actor: { id: string; role: UserRole },
  input: SendReturnToDelhiveryInput,
): Promise<SendReturnToDelhiveryResult> {
  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: input.refundRequestId },
    include: {
      orderItem: true,
      sellerOrder: {
        include: {
          shipment: true,
          pickupPoint: true,
          seller: { select: { shopName: true } },
          checkoutGroup: { include: { addressSnapshot: true } },
        },
      },
    },
  });
  if (!refundRequest) return { ok: false, error: "Return request not found." };
  if (!refundRequest.orderItem) {
    return {
      ok: false,
      error: "This refund covers the whole order, not a single item — reverse pickup doesn't apply.",
    };
  }
  if (refundRequest.status !== "APPROVED" && refundRequest.status !== "REFUNDED") {
    return { ok: false, error: "This return must be approved before scheduling a pickup." };
  }
  const order = refundRequest.sellerOrder;
  if (!order.shipment) return { ok: false, error: "This order has no shipment on file." };
  if (order.shipment.provider !== "DELHIVERY") {
    return {
      ok: false,
      error: "This order wasn't shipped via Delhivery — arrange its return pickup manually instead.",
    };
  }
  if (order.shipment.returnShipmentId) {
    return { ok: false, error: "A return pickup has already been scheduled for this order." };
  }
  const address = order.checkoutGroup.addressSnapshot;
  if (!address) {
    return { ok: false, error: "This order has no delivery address on file — can't schedule pickup." };
  }
  if (!order.pickupPoint) {
    return { ok: false, error: "This order has no pickup point to return the parcel to." };
  }
  const account = (order.shipment.delhiveryAccount ?? "MARKETING1") as DelhiveryAccountKey;
  // The parcel goes back to the pickup point's CURRENT address, registered
  // (idempotently) on the account the forward shipment used.
  const returnWarehouse = await ensureDelhiveryWarehouse(account, order.pickupPoint, {
    useKnownNameOnFailure: true,
  });
  if (!returnWarehouse.ok) {
    return {
      ok: false,
      error: `Delhivery: could not register the seller's pickup point for the return (${returnWarehouse.error}).`,
    };
  }
  const returnWarehouseName = returnWarehouse.name;
  const item = refundRequest.orderItem;
  const dims = await estimateReturnPackageForItem(item.id, {
    lengthCm: input.packageLengthCm,
    breadthCm: input.packageBreadthCm,
    heightCm: input.packageHeightCm,
    weightGrams: input.packageWeightGrams,
  });

  const created = await delhiveryCreateReverseShipment(account, {
    orderNumber: `${order.orderNumber}-RETURN`,
    returnWarehouseName,
    pickupName: address.fullName,
    pickupPhone: address.mobile,
    pickupAddress:
      [address.line1, address.line2, address.landmark].filter(Boolean).join(", ") || address.line1,
    pickupPincode: address.pincode,
    pickupCity: address.cityTown ?? undefined,
    pickupState: address.state ?? undefined,
    productsDesc: item.productName,
    weightGrams: dims.weightGrams,
    lengthCm: dims.lengthCm,
    breadthCm: dims.breadthCm,
    heightCm: dims.heightCm,
  });
  if (!created.ok) return { ok: false, error: `Delhivery: ${created.error}` };

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: order.shipment!.id },
      data: { returnShipmentId: created.data.waybill, returnRequestedAt: new Date() },
    });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: order.shipment!.id,
        status: null,
        courierStatusDesc: `Return pickup scheduled with Delhivery (AWB ${created.data.waybill})`,
        rawProviderResponse: created.raw as Prisma.InputJsonValue,
      },
    });
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "DELHIVERY_RETURN_SCHEDULED",
    entityType: "SellerOrder",
    entityId: order.id,
    metadata: { waybill: created.data.waybill, refundRequestId: refundRequest.id },
  });
  await notifyBuyer({
    customerId: order.customerId,
    title: "Return pickup scheduled",
    body: `A courier will pick up your return for order ${order.orderNumber} soon.`,
  });

  return { ok: true };
}
