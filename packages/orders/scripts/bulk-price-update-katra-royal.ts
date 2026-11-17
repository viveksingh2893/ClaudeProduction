/**
 * One-time bulk price increase for sellers "Katra" and "Royal Traders":
 * customer taxable prices +2%, dealer taxable prices +3%, computed from the
 * TAXABLE value (see bulk-price-update.ts's computePriceIncrease) — never
 * a naive multiply-the-tax-inclusive-price-directly formula.
 *
 * Run locally only, via:
 *
 *   pnpm --filter @kisan4u/orders bulk-price-update:katra-royal            # dry run (default)
 *   pnpm --filter @kisan4u/orders bulk-price-update:katra-royal -- --apply # writes to the database
 *
 * Only APPROVED (live) products are touched — deactivated/draft products
 * are left alone (see bulk-price-update.ts's module doc comment).
 *
 * DRY RUN is the default — nothing is ever written without --apply.
 * Refuses to run --apply a second time (checks the AuditLog marker before
 * writing anything).
 *
 * MRP handling: a zero-markdown record (old sellingPrice === old MRP)
 * whose increase would exceed its MRP has its MRP raised to match the new
 * price — reported per-row as "[MRP SYNCED]" and counted in the totals,
 * never silent. Any OTHER record that would exceed its MRP ("[MRP
 * CONFLICT — BLOCKING]") makes the script refuse to write ANYTHING until
 * it's resolved or the product is explicitly excluded.
 */
import "dotenv/config";
import { prisma } from "@kisan4u/db";
import {
  resolveSellerByExactName,
  planBulkPriceUpdate,
  applyBulkPriceUpdate,
  type SellerScope,
} from "../src/bulk-price-update";

const APPLY = process.argv.includes("--apply");

// Exact shopName values only — resolveSellerByExactName does a strict
// case-sensitive equals match, never partial/fuzzy, per the migration's
// explicit safety requirement.
const SELLER_NAMES = ["Katra", "Royal Traders"];

// No real logged-in user triggers this — a stable, clearly-non-human
// sentinel actor id for the AuditLog trail, same "attribute a script run"
// convention the seed/backfill scripts already use informally.
const SCRIPT_ACTOR_ID = "SYSTEM_SCRIPT:bulk-price-update-katra-royal";

function money(n: number): string {
  return `₹${n.toFixed(2)}`;
}

async function main() {
  console.log(
    `Bulk price update — Katra + Royal Traders: ${
      APPLY
        ? "APPLY MODE — this WILL write to the database"
        : "DRY RUN (default) — no writes will happen. Pass --apply to write."
    }\n`,
  );

  const sellers: SellerScope[] = [];
  for (const name of SELLER_NAMES) {
    const scope = await resolveSellerByExactName(name);
    console.log(`Resolved seller "${name}" -> id ${scope.sellerId}`);
    sellers.push(scope);
  }

  const plan = await planBulkPriceUpdate(sellers);

  console.log(`\n=== Audit report: ${plan.updates.length} planned price update(s) ===`);
  for (const u of plan.updates) {
    const tag = u.mrpSyncApplied
      ? "[MRP SYNCED] "
      : u.mrpConflict
        ? "[MRP CONFLICT — BLOCKING] "
        : "";
    const where = u.variantId ? `Variant ${u.variantId} (${u.variantSku})` : "Base config (no-variant/card price)";
    const mrpNote = u.mrpSyncApplied
      ? ` | MRP ${money(u.mrp)} -> ${money(u.newMrp)} (raised to match)`
      : u.mrpConflict
        ? ` | MRP ${money(u.mrp)} EXCEEDED (old price != old MRP — blocks apply)`
        : "";
    console.log(
      `${tag}Product ${u.productId} "${u.productName}" | ${where} | ${u.audience} | ` +
        `tax ${u.taxPercent}% (${u.taxCalcMode}) | old ${money(u.oldSellingPrice)} ` +
        `(taxable ${money(u.oldTaxableValue)}) | +${u.increasePercent}% -> ` +
        `new taxable ${money(u.newTaxableValue)} | new ${money(u.newSellingPrice)}` +
        mrpNote,
    );
  }

  if (plan.skipped.length > 0) {
    console.log(`\n=== Skipped — out of scope by design, not an error (${plan.skipped.length}) ===`);
    for (const s of plan.skipped) {
      console.log(
        `Product ${s.productId} "${s.productName}"${s.variantId ? ` | Variant ${s.variantId}` : ""} | ${
          s.audience ?? "—"
        } | ${s.reason}`,
      );
    }
  }

  if (plan.rejected.length > 0) {
    console.log(`\n=== Rejected — invalid data, needs manual review (${plan.rejected.length}) ===`);
    for (const r of plan.rejected) {
      console.log(
        `Product ${r.productId} "${r.productName}"${r.variantId ? ` | Variant ${r.variantId}` : ""} | ${
          r.audience ?? "—"
        } | ${r.reason}`,
      );
    }
  }

  console.log("\n=== Totals ===");
  console.log(`  Products examined (APPROVED only):  ${plan.productsExamined}`);
  console.log(`  Products affected:                  ${plan.productsAffected}`);
  console.log(`  Variants examined:                  ${plan.variantsExamined}`);
  console.log(`  Variants affected:                  ${plan.variantsAffected}`);
  console.log(`  Customer prices ${APPLY ? "updated" : "planned"}:           ${plan.customerPricesPlanned}`);
  console.log(`  Dealer prices ${APPLY ? "updated" : "planned"}:             ${plan.dealerPricesPlanned}`);
  console.log(`  Records skipped (out of scope):     ${plan.skipped.length}`);
  console.log(`  Records rejected (invalid data):    ${plan.rejected.length}`);
  console.log(`  MRP conflicts — total:             ${plan.mrpConflicts.length}`);
  console.log(`    of which zero-markdown (MRP synced up):   ${plan.mrpSynced.length}`);
  console.log(`    of which BLOCKING (other cause):          ${plan.blockingMrpConflicts.length}`);

  if (plan.alreadyApplied) {
    console.log(
      "\nThis migration's audit marker already exists in AuditLog — it has been applied before.",
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN complete — no changes were written. Re-run with --apply to write these changes.");
    await prisma.$disconnect();
    return;
  }

  if (plan.alreadyApplied) {
    console.log("Refusing to run --apply again.");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (plan.blockingMrpConflicts.length > 0) {
    console.log(
      `\n${plan.blockingMrpConflicts.length} record(s) would exceed their own MRP for a reason other than zero markdown — refusing to apply ANYTHING until resolved. See the "[MRP CONFLICT — BLOCKING]" lines above.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const result = await applyBulkPriceUpdate(plan, SCRIPT_ACTOR_ID);
  if (!result.ok) {
    console.log(`\nApply failed: ${result.error}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(
    `\nApplied ${result.updatedCount} price update(s) inside one transaction. Audit marker written — this migration will refuse to run again.`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
