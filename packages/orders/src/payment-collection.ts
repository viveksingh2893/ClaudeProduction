/**
 * Completes a not-yet-fully-collected payment for ONE seller order — COD
 * (Payment stays PENDING, nothing collected until delivery) or the
 * deferred remainder of an ONLINE_PARTIAL order (Payment stays
 * PARTIALLY_PAID, with Payment.totalAmount scoped to only the advance —
 * see checkout.ts's `chargeAmount = isPartial ? advancePlan.advanceAmount
 * : grandTotal`). An already-PAID order (ONLINE_FULL/WALLET success at
 * checkout) has no outstanding balance, so every entry point here is a
 * safe no-op for it.
 *
 * Recorded on PaymentAllocation.remainingCollectedAmount, NEVER by
 * mutating the shared Payment row's own amountPaid/totalAmount — see that
 * column's schema doc comment for why: one Payment can be split across
 * several seller orders (PaymentAllocation per seller, multi-seller
 * checkout), and every existing "how much of this seller order's payment
 * has been collected" read (this file, and the admin order detail page)
 * prorates via `allocation.amount * (payment.amountPaid /
 * payment.totalAmount)`. Mutating the shared totalAmount/amountPaid to
 * represent one seller's later COD/remainder collection would silently
 * corrupt that ratio for every OTHER seller order sharing the same
 * Payment. The additive `remainingCollectedAmount` column avoids that
 * entirely — it only ever affects the seller order it belongs to.
 *
 * Two entry points share the same core logic:
 *   - recordPaymentCollected: the admin's manual "Record payment
 *     collected" action on the order detail page (source ADMIN).
 *   - autoCompletePaymentOnDelivery: called automatically, inside the same
 *     transaction as the DELIVERED status write (order-workflow.ts), for
 *     EVERY delivery — cash (or a deferred online balance) is understood
 *     to be collected at the point of delivery for COD and partial-payment
 *     orders (source SYSTEM). Never blocks or fails the delivery
 *     transition itself.
 */
import { prisma, type UserRole, type OrderEventSource } from "@kisan4u/db";
import { round2, allocateProportionally } from "./money";
import { writeAuditLog } from "./audit";

type PaymentCollectionTxClient = Pick<
  typeof prisma,
  "sellerOrder" | "payment" | "paymentAllocation" | "paymentStatusHistory"
>;

type ApplyPaymentCollectionResult = { ok: true; collected: number } | { ok: false; error: string };

/**
 * This seller order's own already-collected total: the prorated share of
 * whatever the original payment attempt captured, plus anything collected
 * afterward. Exported for display purposes (order tables/detail pages'
 * "amount paid so far" column) — the write path in this file is the only
 * thing that ever changes what this adds up to.
 */
export function paidSoFarFor(
  allocations: {
    amount: unknown;
    remainingCollectedAmount: unknown;
    payment: { amountPaid: unknown; totalAmount: unknown };
  }[],
): number {
  return allocations.reduce(
    (total, a) =>
      total +
      Number(a.amount) * (Number(a.payment.amountPaid) / Number(a.payment.totalAmount || 1)) +
      Number(a.remainingCollectedAmount),
    0,
  );
}

/** The actual amount a customer owes for one seller order — net of whatever discount applied (OrderCharge.customerPayableTotal), falling back to the order's own gross total only if no OrderCharge exists yet. */
export function netPayableForOrder(order: {
  totalAmount: unknown;
  charge: { customerPayableTotal: unknown } | null;
}): number {
  return order.charge ? Number(order.charge.customerPayableTotal) : Number(order.totalAmount);
}

async function applyPaymentCollection(
  tx: PaymentCollectionTxClient,
  sellerOrderId: string,
  source: OrderEventSource,
  collectedAmount?: number,
): Promise<ApplyPaymentCollectionResult> {
  const sellerOrder = await tx.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: { charge: true, paymentAllocations: { include: { payment: true } } },
  });
  if (!sellerOrder) return { ok: false, error: "Order not found." };
  // Defense-in-depth, not just the admin UI hiding the control: a
  // cancelled order's outstanding balance is moot — nothing is being
  // fulfilled, so nothing should ever be recorded as collected against it.
  if (sellerOrder.status === "CANCELLED") {
    return { ok: false, error: "This order is cancelled — payment cannot be collected against it." };
  }
  if (sellerOrder.paymentAllocations.length === 0) {
    return { ok: false, error: "No payment record exists for this order yet." };
  }

  // Same "net payable" formula as the admin order detail page
  // (apps/dashboard/src/app/admin/orders/[id]/page.tsx) — kept in sync
  // deliberately so the outstanding figure shown to the admin always
  // matches what this function will actually collect.
  const netPayable = sellerOrder.charge
    ? Number(sellerOrder.charge.customerPayableTotal)
    : Number(sellerOrder.totalAmount);
  const outstanding = round2(
    Math.max(0, netPayable - paidSoFarFor(sellerOrder.paymentAllocations)),
  );
  if (outstanding <= 0) return { ok: true, collected: 0 };

  const amountToCollect = collectedAmount != null ? round2(collectedAmount) : outstanding;
  if (!Number.isFinite(amountToCollect) || amountToCollect <= 0) {
    return { ok: false, error: "Enter a valid amount greater than zero." };
  }
  // Small epsilon for floating-point/rounding slack, never enough to let a
  // meaningfully-too-large amount through.
  if (amountToCollect > outstanding + 0.01) {
    return {
      ok: false,
      error: `Cannot collect more than the outstanding balance of ₹${outstanding.toFixed(2)}.`,
    };
  }

  // Distributed across this seller order's own allocation rows (almost
  // always exactly one — more than one only happens if this seller order
  // was ever covered by more than one payment attempt, e.g. a retry)
  // proportional to each allocation's own `amount` — a value this
  // function never mutates, so the split stays stable across repeated
  // partial collections.
  const weights = sellerOrder.paymentAllocations.map((a) => Number(a.amount));
  const shares = allocateProportionally(
    amountToCollect,
    weights.some((w) => w > 0) ? weights : weights.map(() => 1),
  );

  for (let i = 0; i < sellerOrder.paymentAllocations.length; i++) {
    const share = shares[i]!;
    if (share <= 0) continue;
    const allocation = sellerOrder.paymentAllocations[i]!;

    await tx.paymentAllocation.update({
      where: { id: allocation.id },
      data: { remainingCollectedAmount: { increment: share } },
    });

    // Advance the shared Payment's own status badge based on EVERY seller
    // order it covers (not just this one) — PAID only once every sibling
    // is fully collected (a Payment shared across sellers can't honestly
    // be called "paid" while one seller's own share is still outstanding),
    // PARTIALLY_PAID as soon as any collection has happened at all. Never
    // touches amountPaid/totalAmount (see file doc comment) — only the
    // display-facing status enum. Re-read AFTER the update above, so
    // `remainingCollectedAmount` already reflects this allocation's own
    // just-added `share` — must NOT be added again here.
    const siblingAllocations = await tx.paymentAllocation.findMany({
      where: { paymentId: allocation.paymentId },
      include: { payment: true, sellerOrder: { include: { charge: true } } },
    });
    let allFullyCollected = true;
    let anyCollected = false;
    for (const sibling of siblingAllocations) {
      const siblingNetPayable = sibling.sellerOrder.charge
        ? Number(sibling.sellerOrder.charge.customerPayableTotal)
        : Number(sibling.sellerOrder.totalAmount);
      const siblingCollected =
        Number(sibling.amount) *
          (Number(sibling.payment.amountPaid) / Number(sibling.payment.totalAmount || 1)) +
        Number(sibling.remainingCollectedAmount);
      if (siblingCollected >= siblingNetPayable - 0.01) anyCollected = true;
      else {
        allFullyCollected = false;
        if (siblingCollected > 0.005) anyCollected = true;
      }
    }

    const newStatus = allFullyCollected
      ? "PAID"
      : anyCollected
        ? "PARTIALLY_PAID"
        : allocation.payment.status;
    if (newStatus !== allocation.payment.status) {
      await tx.payment.update({ where: { id: allocation.paymentId }, data: { status: newStatus } });
    }
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: allocation.paymentId,
        status: newStatus,
        source,
        note:
          source === "SYSTEM"
            ? `₹${share.toFixed(2)} automatically marked collected on delivery for order ${sellerOrder.orderNumber}`
            : `₹${share.toFixed(2)} collected for order ${sellerOrder.orderNumber}`,
      },
    });
  }

  return { ok: true, collected: amountToCollect };
}

export type RecordPaymentCollectedResult =
  { ok: true; collected: number } | { ok: false; error: string };

/**
 * Admin-only — caller's Server Action must independently verify the actor
 * is an admin before calling this (same convention as every other
 * function in access.ts/settlement.ts). `collectedAmount` omitted means
 * "collect the full outstanding balance"; supplying a smaller value
 * records a genuine partial/short collection instead.
 */
export async function recordPaymentCollected(
  sellerOrderId: string,
  actor: { id: string; role: UserRole },
  collectedAmount?: number,
): Promise<RecordPaymentCollectedResult> {
  const result = await prisma.$transaction((tx) =>
    applyPaymentCollection(tx, sellerOrderId, "ADMIN", collectedAmount),
  );
  if (result.ok && result.collected > 0) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "PAYMENT_COLLECTED",
      entityType: "SellerOrder",
      entityId: sellerOrderId,
      metadata: { amountCollected: result.collected },
    });
  }
  return result;
}

/**
 * Called from order-workflow.ts, inside the SAME transaction as the
 * DELIVERED status write, for every delivery — never only for COD, since
 * gating isn't needed: an already-PAID order simply has ₹0 outstanding
 * and this is a no-op for it. Deliberately swallows a `{ ok: false }`
 * result rather than throwing — a payment-collection edge case must never
 * block the delivery transition itself or the settlement row it triggers.
 */
export async function autoCompletePaymentOnDelivery(
  tx: PaymentCollectionTxClient,
  sellerOrderId: string,
): Promise<void> {
  await applyPaymentCollection(tx, sellerOrderId, "SYSTEM");
}
