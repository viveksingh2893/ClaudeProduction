/**
 * CLI shell for the settlement backfill/reconciliation — the actual logic
 * lives in packages/orders/src/settlement-reconciliation.ts (reconcileSellerSettlements),
 * which is unit-testable directly (see settlement.test.ts's "backfill is
 * safe to run more than once" test) without going through this process.
 *
 * Run locally only (per project constraints) via:
 *
 *   pnpm --filter @kisan4u/orders backfill:settlements [--dry-run] [--batch-size=200]
 *
 * `--dry-run` reports what WOULD happen without writing anything.
 */
import "dotenv/config";
import { prisma } from "@kisan4u/db";
import { reconcileSellerSettlements } from "../src/settlement-reconciliation";

const DRY_RUN = process.argv.includes("--dry-run");
const batchSizeArg = process.argv.find((a) => a.startsWith("--batch-size="));
const BATCH_SIZE = batchSizeArg ? Number(batchSizeArg.split("=")[1]) : 200;

async function main() {
  console.log(
    `Seller settlement backfill starting${DRY_RUN ? " (DRY RUN — no writes will happen)" : ""}, batch size ${BATCH_SIZE}...`,
  );

  const summary = await reconcileSellerSettlements({
    dryRun: DRY_RUN,
    batchSize: BATCH_SIZE,
    onBatch: (partial) => {
      console.log(
        `  ...checked ${partial.ordersChecked} delivered seller orders (missing found ${partial.missingRowsFound}, created ${partial.rowsCreated}, recomputed ${partial.rowsRecomputed}, skipped-finalized ${partial.skippedFinalized}, errors ${partial.errored})`,
      );
    },
  });

  console.log("\nReconciliation summary:");
  console.log(`  Delivered seller orders checked:      ${summary.ordersChecked}`);
  console.log(
    `  Missing settlement rows found:        ${summary.missingRowsFound}${DRY_RUN ? " (dry run — none created)" : ""}`,
  );
  console.log(`  Settlement rows created:              ${summary.rowsCreated}`);
  console.log(`  Settlement rows recomputed:           ${summary.rowsRecomputed}`);
  console.log(`  Skipped — already finalized:          ${summary.skippedFinalized}`);
  console.log(`  Skipped — no order items:             ${summary.skippedNoItems}`);
  console.log(`  Errors — marked for manual review:    ${summary.errored}`);

  if (summary.failures.length > 0) {
    console.log("\nErrors (no financial values were invented for these — investigate and re-run):");
    for (const f of summary.failures.slice(0, 100))
      console.log(`  - ${f.orderNumber} (${f.sellerOrderId}): ${f.error}`);
    if (summary.failures.length > 100)
      console.log(`  ...and ${summary.failures.length - 100} more`);
  }

  await prisma.$disconnect();
  process.exit(summary.errored > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Backfill script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
