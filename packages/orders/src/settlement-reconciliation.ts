/**
 * The importable core of the settlement backfill/reconciliation script
 * (packages/orders/scripts/backfill-seller-settlements.ts), which is a thin
 * CLI shell around this function (argv parsing, console output,
 * process.exit — none of which belongs in a library function or is
 * testable without killing the test runner). Kept in `src/` rather than
 * `scripts/` specifically so settlement.test.ts can import and exercise the
 * real reconciliation logic directly (e.g. "safe to run twice") instead of
 * only testing the lower-level upsertSettlementsForSellerOrder it calls.
 *
 * Safe to run more than once — walks every SellerOrder with status
 * DELIVERED (optionally scoped to one seller), batched via cursor
 * pagination, and calls the exact same idempotent
 * upsertSettlementsForSellerOrder used by the live markDelivered() hook. A
 * re-run only ever creates rows that don't exist yet or recomputes ones
 * still in a "not yet acted on" status (RECOMPUTABLE_STATUSES); it never
 * duplicates a row (the orderItemId unique constraint enforces that at the
 * database level too) and never touches a row that has already moved to
 * SETTLED/REVERSED/etc. Never modifies any Order/SellerOrder/OrderItem data
 * — only ever writes SellerSettlement rows.
 */
import { prisma } from "@kisan4u/db";
import { upsertSettlementsForSellerOrder } from "./settlement";

export type ReconciliationFailure = { sellerOrderId: string; orderNumber: string; error: string };

export type ReconciliationSummary = {
  ordersChecked: number;
  missingRowsFound: number;
  rowsCreated: number;
  rowsRecomputed: number;
  skippedFinalized: number;
  skippedNoItems: number;
  errored: number;
  failures: ReconciliationFailure[];
};

export type ReconcileOptions = {
  /** Scope to one seller — used by tests to avoid scanning the whole database; the real CLI run omits this to cover every seller. */
  sellerId?: string;
  dryRun?: boolean;
  batchSize?: number;
  onBatch?: (partial: ReconciliationSummary) => void;
};

export async function reconcileSellerSettlements(
  options: ReconcileOptions = {},
): Promise<ReconciliationSummary> {
  const { sellerId, dryRun = false, batchSize = 200, onBatch } = options;

  const summary: ReconciliationSummary = {
    ordersChecked: 0,
    missingRowsFound: 0,
    rowsCreated: 0,
    rowsRecomputed: 0,
    skippedFinalized: 0,
    skippedNoItems: 0,
    errored: 0,
    failures: [],
  };

  let cursor: string | undefined;
  for (;;) {
    const orders = await prisma.sellerOrder.findMany({
      // legacyClosedOut orders were imported already-delivered from the old
      // site (no real charge/logistics record here) and must never be
      // settled — see SellerOrder.legacyClosedOut's doc comment.
      where: { status: "DELIVERED", legacyClosedOut: false, ...(sellerId ? { sellerId } : {}) },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, orderNumber: true, items: { select: { id: true } } },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (orders.length === 0) break;

    for (const order of orders) {
      summary.ordersChecked++;

      if (order.items.length === 0) {
        summary.skippedNoItems++;
        continue;
      }

      // Counted BEFORE this run touches anything, independent of
      // created/recomputed below — a row missing here and not created
      // (e.g. this order's upsert call errors) still shows up as "found,"
      // not silently dropped.
      const existingCount = await prisma.sellerSettlement.count({
        where: { sellerOrderId: order.id },
      });
      summary.missingRowsFound += Math.max(0, order.items.length - existingCount);

      if (dryRun) continue;

      try {
        const result = await prisma.$transaction((tx) =>
          upsertSettlementsForSellerOrder(tx, order.id),
        );
        if (!result.ok) {
          summary.errored++;
          summary.failures.push({
            sellerOrderId: order.id,
            orderNumber: order.orderNumber,
            error: result.error,
          });
          continue;
        }
        summary.rowsCreated += result.created;
        summary.rowsRecomputed += result.updated;
        summary.skippedFinalized += result.skipped;
      } catch (err) {
        summary.errored++;
        summary.failures.push({
          sellerOrderId: order.id,
          orderNumber: order.orderNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    cursor = orders[orders.length - 1]!.id;
    onBatch?.(summary);
    if (orders.length < batchSize) break;
  }

  return summary;
}
