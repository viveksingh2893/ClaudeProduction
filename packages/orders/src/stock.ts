import { prisma, type UserRole } from "@kisan4u/db";
import { recordStockChange, type StockTarget } from "@kisan4u/catalog";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Thrown (never returned) so it aborts and rolls back the enclosing `$transaction` — see checkout.ts, which catches this specific class around its transaction call and turns it into a controlled `{ ok: false }` result instead of a raw 500. */
export class InsufficientStockError extends Error {}

function targetForItem(
  item: { variantId: string | null; productId: string },
  audience: "CUSTOMER" | "DEALER",
): StockTarget {
  return item.variantId
    ? { kind: "variant", variantId: item.variantId }
    : { kind: "base", productId: item.productId, audience };
}

/**
 * Phase 4 spec §N — stock IS implemented at the product/variant level
 * (ProductCustomerConfig.currentStock, ProductDealerConfig.currentStock,
 * ProductVariant.stockQty), so it is genuinely deducted here, not left as
 * an incomplete placeholder. Deduction happens exactly once per seller
 * order, at the moment that order first reaches CONFIRMED (never at
 * PENDING_PAYMENT) — see checkout.ts's applyInitialPayment, the only
 * caller. Each line routes through packages/catalog's recordStockChange,
 * the single choke point every stock-quantity change in the app goes
 * through — it uses the same conditional `updateMany` guarded by
 * `{ gte: quantity }` this function always has, so two concurrent
 * checkouts can never both oversell the last unit, AND it writes a
 * StockAdjustment ledger row (adjustmentType ORDER_SALE) for every line.
 * A guard failure surfaces here as `{ ok: false }`, which this rethrows as
 * InsufficientStockError so the enclosing checkout transaction still
 * rolls back exactly as before — "the entire checkout must fail" (§D)
 * rather than partially confirming.
 *
 * Known Phase 4 limitation (see final report): only the checkout and
 * cancellation flows adjust stock. An admin's manual status override
 * (packages/orders' transitionSellerOrder, used only for exception
 * handling) does NOT deduct/restore stock — that would need its own
 * explicit stock-adjustment step, out of scope for this pass.
 */
export async function deductStockForSellerOrder(
  tx: TxClient,
  sellerOrderId: string,
  actor: { id: string; role: UserRole },
): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { sellerOrderId } });
  const sellerOrder = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: { customerType: true },
  });
  const audience = sellerOrder.customerType === "DEALER" ? "DEALER" : "CUSTOMER";

  for (const item of items) {
    const result = await recordStockChange(tx, {
      target: targetForItem(item, audience),
      change: { mode: "delta", delta: -item.quantity },
      adjustmentType: "ORDER_SALE",
      sourceType: "ORDER",
      relatedOrderId: sellerOrderId,
      performedBy: actor,
    });
    if (!result.ok) {
      throw new InsufficientStockError(
        `Insufficient stock for a line in order ${sellerOrderId}: ${result.error}`,
      );
    }
  }
}

/** Restores stock deducted by deductStockForSellerOrder — called only when cancelling an order that had already reached CONFIRMED or later (§M: "cancellation must restore reserved stock"). `actor` is the admin who approved the cancellation (decideCancellation's caller). */
export async function restoreStockForSellerOrder(
  tx: TxClient,
  sellerOrderId: string,
  actor: { id: string; role: UserRole },
): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { sellerOrderId } });
  const sellerOrder = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: { customerType: true },
  });
  const audience = sellerOrder.customerType === "DEALER" ? "DEALER" : "CUSTOMER";

  for (const item of items) {
    const result = await recordStockChange(tx, {
      target: targetForItem(item, audience),
      change: { mode: "delta", delta: item.quantity },
      adjustmentType: "ORDER_CANCELLATION_RESTORE",
      sourceType: "CANCELLATION",
      relatedOrderId: sellerOrderId,
      performedBy: actor,
    });
    if (!result.ok) {
      // Restoration only ever increments — the guard in recordStockChange
      // can't fail on a positive delta, so this branch is unreachable in
      // practice. Still surfaced rather than swallowed, in case the
      // target itself no longer resolves (e.g. a hard-deleted variant).
      throw new Error(`Failed to restore stock for order ${sellerOrderId}: ${result.error}`);
    }
  }
}

/** A seller order that reached at least CONFIRMED has had stock deducted — used by cancellation.ts to decide whether a restoration is needed. */
export function hasStockBeenDeducted(status: string): boolean {
  return status !== "PENDING_PAYMENT" && status !== "PAYMENT_PARTIALLY_RECEIVED";
}
