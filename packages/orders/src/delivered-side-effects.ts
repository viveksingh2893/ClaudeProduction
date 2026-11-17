import { prisma } from "@kisan4u/db";
import { autoCompletePaymentOnDelivery } from "./payment-collection";
import { upsertSettlementsForSellerOrder } from "./settlement";
import { awardLoyaltyPointsForDeliveredOrder } from "./loyalty-points";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/**
 * The three things that must happen the moment a seller order reaches
 * DELIVERED, regardless of HOW it got there:
 *
 *  1. autoCompletePaymentOnDelivery — the outstanding balance (COD in
 *     full, an ONLINE_PARTIAL remainder) is treated as collected on the
 *     doorstep. No-op for an already-fully-paid order.
 *  2. upsertSettlementsForSellerOrder — creates the settlement rows
 *     (idempotent; keyed by orderItemId).
 *  3. awardLoyaltyPointsForDeliveredOrder — dealer reward points
 *     (single-trigger-guarded; no-op for a customer order).
 *
 * Must be called INSIDE the caller's own `prisma.$transaction`, right
 * after the DELIVERED status write, so the whole thing commits or rolls
 * back together. Safe to reach more than once (every step is idempotent).
 *
 * Called from BOTH delivery paths:
 *  - applyShipmentStatusTransition (order-workflow.ts) — the mock/RapidShyp
 *    "Mark delivered" button, which needs a shipment/AWB.
 *  - transitionSellerOrder (status-transitions.ts) — the generic admin
 *    status-override dropdown, which an admin uses to deliver an order
 *    that never had a shipment created. This path previously skipped all
 *    three, so payment stayed uncollected and no settlement row appeared.
 */
export async function runDeliveredSideEffects(
  tx: TxClient,
  sellerOrderId: string,
): Promise<void> {
  await autoCompletePaymentOnDelivery(tx, sellerOrderId);
  await upsertSettlementsForSellerOrder(tx, sellerOrderId);
  await awardLoyaltyPointsForDeliveredOrder(tx, sellerOrderId);
}
