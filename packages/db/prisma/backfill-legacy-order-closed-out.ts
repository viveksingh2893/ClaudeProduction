/**
 * One-time backfill for SellerOrder rows created by migrate-legacy-orders.ts
 * / migrate-legacy-dealer-orders.ts BEFORE the legacyClosedOut split existed
 * (everything migrated on/before 2026-08-22 was unconditionally given a
 * "LEGACY-..." orderNumber regardless of status). Brings those rows in line
 * with the same rule the migration scripts now apply going forward:
 *
 *   - status in (DELIVERED, CANCELLED, RETURN_APPROVED, DELIVERY_FAILED)
 *     -> legacyClosedOut = true, orderNumber left as-is (already
 *        "LEGACY-...", excluded from settlement by the DB flag now, not by
 *        the prefix).
 *   - anything else (still in-progress at import time) -> legacyClosedOut
 *     stays false (already the column default) and orderNumber is
 *     regenerated to a normal-looking K4U-YYYYMMDD-XXXX-S1 number, dated
 *     from the order's real historical createdAt, so it reads like a
 *     proper live order and can settle normally once genuinely delivered.
 *
 * Idempotent/safe to re-run: only ever touches rows whose orderNumber still
 * starts with "LEGACY" (a row already fixed is left alone).
 *
 * Usage:
 *   tsx prisma/backfill-legacy-order-closed-out.ts --dry-run
 *   tsx prisma/backfill-legacy-order-closed-out.ts
 */
import "dotenv/config";
import { PrismaClient, OrderStatus } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const LEGACY_CLOSED_OUT_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.RETURN_APPROVED,
  OrderStatus.DELIVERY_FAILED,
]);

function legacyDatePart(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function randomSuffix(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await prisma.sellerOrder.findMany({
    where: { legacyOrderId: { not: null }, orderNumber: { startsWith: "LEGACY" } },
    select: { id: true, status: true, createdAt: true, orderNumber: true, legacyClosedOut: true },
  });

  console.log(`Found ${rows.length} not-yet-backfilled legacy SellerOrder row(s).`);

  let closedOutFlagged = 0;
  let renumbered = 0;

  const toClose = rows.filter((r) => LEGACY_CLOSED_OUT_STATUSES.has(r.status));
  const toRenumber = rows.filter((r) => !LEGACY_CLOSED_OUT_STATUSES.has(r.status));

  console.log(`  -> ${toClose.length} to flag legacyClosedOut=true (orderNumber unchanged)`);
  console.log(`  -> ${toRenumber.length} to renumber + leave legacyClosedOut=false`);

  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  if (toClose.length > 0) {
    const result = await prisma.sellerOrder.updateMany({
      where: { id: { in: toClose.map((r) => r.id) } },
      data: { legacyClosedOut: true },
    });
    closedOutFlagged = result.count;
  }

  for (const r of toRenumber) {
    const date = legacyDatePart(r.createdAt);
    let newNumber: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `K4U-${date}-${randomSuffix()}-S1`;
      const existing = await prisma.sellerOrder.findUnique({
        where: { orderNumber: candidate },
        select: { id: true },
      });
      if (!existing) {
        newNumber = candidate;
        break;
      }
    }
    if (!newNumber) {
      console.log(`  WARNING: could not find a free order number for ${r.id} (${r.orderNumber}) after 10 attempts — skipped.`);
      continue;
    }
    await prisma.sellerOrder.update({
      where: { id: r.id },
      data: { orderNumber: newNumber, legacyClosedOut: false },
    });
    renumbered++;
  }

  console.log(`Done. legacyClosedOut flagged: ${closedOutFlagged}. Renumbered: ${renumbered}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
