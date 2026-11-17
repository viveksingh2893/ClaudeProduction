import { prisma, Prisma, type UserRole } from "@kisan4u/db";
import {
  rapidshypCancelOrder,
  delhiveryCancelShipment,
  type DelhiveryAccountKey,
} from "@kisan4u/providers";
import { writeAuditLog } from "./audit";

// Same value as RAPIDSHYP_STORE_NAME in rapidshyp-shipping.ts — inlined
// here to keep this module free of a rapidshyp-shipping.ts import (which
// would create a cycle through status-transitions.ts).
const RAPIDSHYP_STORE_NAME = "DEFAULT";

export type CourierCancelOutcome = { ok: boolean; note: string };

/**
 * Best-effort cancel of the courier-side shipment when an order is
 * cancelled in our system. Never throws and never blocks the order
 * cancellation — the SellerOrder is already CANCELLED by the time this
 * runs; this just tells the courier so no pickup is attempted, records
 * the outcome on ShipmentStatusHistory (visible in the order's tracking
 * history) and in the audit log.
 *
 *  - RAPIDSHYP  -> POST cancel_order  (by rapidshypOrderId + store)
 *  - DELHIVERY  -> POST /api/p/edit   (by waybill, on the SAME account the
 *                                      shipment was booked on)
 *  - MOCK / no shipment -> nothing to do.
 */
export async function cancelCourierShipmentForOrder(
  sellerOrderId: string,
  actor?: { id: string; role: UserRole },
): Promise<CourierCancelOutcome> {
  const shipment = await prisma.shipment.findUnique({
    where: { sellerOrderId },
    select: {
      id: true,
      provider: true,
      rapidshypOrderId: true,
      awbNumber: true,
      delhiveryAccount: true,
    },
  });
  if (!shipment) return { ok: true, note: "No shipment — nothing to cancel with a courier." };

  let outcome: CourierCancelOutcome;
  let raw: unknown = null;
  try {
    if (shipment.provider === "RAPIDSHYP" && shipment.rapidshypOrderId) {
      const r = await rapidshypCancelOrder({
        orderId: shipment.rapidshypOrderId,
        storeName: RAPIDSHYP_STORE_NAME,
      });
      raw = r.raw;
      outcome = r.ok
        ? { ok: true, note: "Cancelled on RapidShyp." }
        : { ok: false, note: `RapidShyp cancellation failed: ${r.error}` };
    } else if (shipment.provider === "DELHIVERY" && shipment.awbNumber) {
      const account = (shipment.delhiveryAccount ?? "MARKETING1") as DelhiveryAccountKey;
      const r = await delhiveryCancelShipment(account, shipment.awbNumber);
      raw = r.raw;
      outcome = r.ok
        ? { ok: true, note: `Cancelled on Delhivery (${account}).` }
        : { ok: false, note: `Delhivery cancellation failed: ${r.error}` };
    } else {
      return { ok: true, note: "Manual/mock shipment — no courier to cancel." };
    }
  } catch (e) {
    outcome = { ok: false, note: `Courier cancellation errored: ${(e as Error).message}` };
  }

  await prisma.shipmentStatusHistory
    .create({
      data: {
        shipmentId: shipment.id,
        status: null,
        courierStatusDesc: outcome.note,
        rawProviderResponse: (raw ?? {}) as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  if (actor) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: outcome.ok ? "COURIER_SHIPMENT_CANCELLED" : "COURIER_SHIPMENT_CANCEL_FAILED",
      entityType: "SellerOrder",
      entityId: sellerOrderId,
      reason: outcome.note,
    }).catch(() => {});
  }

  return outcome;
}
