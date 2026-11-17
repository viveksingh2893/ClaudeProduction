/**
 * One-time bulk price-increase migration for two named sellers (see the
 * CLI wrapper, scripts/bulk-price-update-katra-royal.ts) — NOT a permanent
 * catalogue pricing behaviour. Increases the tax-INCLUSIVE selling price of
 * every price-bearing record (a no-variant product's audience config, a
 * variant product's own "Display on product card" base config when it's
 * actually set, and every variant) by extracting the taxable value,
 * applying a flat percentage increase to THAT, then reapplying the same
 * tax rate — never a naive `price * (1 + pct/100)` that would double-count
 * an already-baked-in tax on top.
 *
 * Built on packages/orders/src/money.ts's Decimal primitives (toDecimal/
 * decimalToMoney) — the same precision/rounding convention as
 * resolveTaxBreakdown, not a reinvented one. Only the FINAL stored
 * sellingPrice is ever rounded; every intermediate step stays at full
 * Decimal precision, which is what makes ₹1,000 @ 18% tax, +3% come out to
 * exactly ₹1,030.00 rather than ₹1,029.9984 from premature rounding.
 *
 * SCOPE: only APPROVED (live) products are touched — DRAFT/SUBMITTED/
 * REJECTED/SUSPENDED/INACTIVE are left alone. Some Katra/Royal products
 * were deliberately deactivated (INACTIVE) just before this migration was
 * resumed; a one-time live-price increase has no business rewriting the
 * price of a product that's been pulled from sale.
 *
 * MRP-CONFLICT HANDLING: an increase that would push a record's new
 * sellingPrice above its own MRP normally blocks the WHOLE run (nothing
 * is written until it's resolved). There is ONE explicit, audited
 * exception: a record whose OLD sellingPrice was exactly equal to its OLD
 * MRP (a zero-markdown record — the cause of essentially every conflict in
 * the first dry run) has its MRP raised to match the new sellingPrice
 * instead of blocking. That exception is scoped to exactly that case: any
 * conflict where old sellingPrice !== old MRP still blocks the entire run
 * and is reported for manual review, never auto-resolved.
 */
import { prisma, Prisma } from "@kisan4u/db";
import { toDecimal, decimalToMoney, type TaxCalcMode } from "./money";

export type BulkPriceUpdateAudience = "CUSTOMER" | "DEALER";

/** Fixed per the business requirement — customer +2%, dealer +3%. Not configurable per-call: this is a one-time, specific migration, not a general-purpose tool. */
const INCREASE_PERCENT: Record<BulkPriceUpdateAudience, number> = {
  CUSTOMER: 2,
  DEALER: 3,
};

/**
 * Idempotency marker — one AuditLog row (see packages/orders/src/audit.ts),
 * written only inside the same transaction as a successful apply.
 * `entityId` is a FIXED string (not per-run/timestamped) so a second apply
 * attempt — today, next week, after a redeploy — finds this exact row and
 * refuses to run again, per the "cannot accidentally increase the same
 * prices twice" requirement. There is no dedicated migration-tracking
 * table in this schema; AuditLog is the existing generic mechanism, reused
 * here rather than inventing a new one.
 */
export type MigrationMarker = { action: string; entityType: string; entityId: string };

export const BULK_PRICE_UPDATE_MARKER: MigrationMarker = {
  action: "BULK_PRICE_INCREASE_APPLIED",
  entityType: "BulkPriceUpdate",
  entityId: "katra-royal-2026-tax-inclusive-cust2pct-dealer3pct",
};

/**
 * `marker` defaults to the real migration's fixed marker (what the CLI
 * script always uses) — accepting an override exists ONLY so this
 * function's own idempotency test suite can use a unique per-run marker
 * instead. A test that exercised the real BULK_PRICE_UPDATE_MARKER would
 * write (or need to clean up) the actual production guard row, which
 * risks either leaving a stray marker that wrongly blocks the real
 * migration later, or — worse — a test accidentally clearing it and
 * letting the real migration run twice. Never pass an override outside a
 * test.
 */
export async function isBulkPriceUpdateAlreadyApplied(marker: MigrationMarker = BULK_PRICE_UPDATE_MARKER): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: {
      action: marker.action,
      entityType: marker.entityType,
      entityId: marker.entityId,
    },
    select: { id: true },
  });
  return !!existing;
}

export type SellerScope = { sellerId: string; label: string };

/**
 * Resolves a seller by an EXACT, case-sensitive shopName match — never
 * partial/fuzzy/case-insensitive (the migration's explicit safety
 * requirement: "do not use loose matching for the final update"). Throws
 * (refuses to proceed) if zero or more than one seller matches, rather
 * than silently picking one — an ambiguous or renamed seller must block
 * the run, not guess.
 */
export async function resolveSellerByExactName(shopName: string): Promise<SellerScope> {
  const matches = await prisma.sellerProfile.findMany({
    where: { shopName },
    select: { id: true, shopName: true },
  });
  if (matches.length === 0) {
    throw new Error(`No seller found with shopName exactly "${shopName}".`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} sellers found with shopName exactly "${shopName}" (ids: ${matches
        .map((m) => m.id)
        .join(", ")}) — ambiguous, refusing to proceed.`,
    );
  }
  return { sellerId: matches[0]!.id, label: matches[0]!.shopName };
}

export type PriceRecordKind = "NO_VARIANT_CONFIG" | "VARIANT_BASE_CONFIG" | "VARIANT";

export type PlannedPriceUpdate = {
  kind: PriceRecordKind;
  audience: BulkPriceUpdateAudience;
  sellerId: string;
  sellerLabel: string;
  productId: string;
  productName: string;
  /** Null for a no-variant product or a variant-product's own base config row — only set for an actual ProductVariant. */
  variantId: string | null;
  variantSku: string | null;
  taxPercent: number;
  taxCalcMode: TaxCalcMode;
  oldSellingPrice: number;
  /** Display-only breakdown for the audit report — never fed back into the new-price calculation (that's derived at full precision directly from oldSellingPrice, see computePriceIncrease). */
  oldTaxableValue: number;
  increasePercent: number;
  newTaxableValue: number;
  newSellingPrice: number;
  /** The record's OLD MRP (as stored before this migration). */
  mrp: number;
  /** The MRP that will be stored after apply: unchanged (=== `mrp`) for every record except an mrpSyncApplied one, where it's raised to `newSellingPrice`. */
  newMrp: number;
  /** Raw flag: newSellingPrice > old `mrp`. On its own this no longer necessarily blocks — see `mrpSyncApplied` / `blockingMrpConflicts`. */
  mrpConflict: boolean;
  /** True for a conflict where old sellingPrice === old MRP (zero markdown): apply() raises this record's MRP to `newMrp` instead of blocking. */
  mrpSyncApplied: boolean;
};

export type SkippedOrRejectedRecord = {
  kind: PriceRecordKind;
  audience: BulkPriceUpdateAudience | null;
  sellerId: string;
  sellerLabel: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantSku: string | null;
  reason: string;
};

export type BulkPriceUpdatePlan = {
  sellers: SellerScope[];
  productsExamined: number;
  productsAffected: number;
  variantsExamined: number;
  variantsAffected: number;
  customerPricesPlanned: number;
  dealerPricesPlanned: number;
  updates: PlannedPriceUpdate[];
  /** Out of scope BY DESIGN (a variant product's base config with no real "card price" set — mrp=0, never displayed; or any record whose sellingPrice is 0 — no price to increase) — not an error. */
  skipped: SkippedOrRejectedRecord[];
  /** Invalid data (missing/negative price, missing/invalid tax rate) — needs manual review, never guessed. */
  rejected: SkippedOrRejectedRecord[];
  /** Every `updates` row where newSellingPrice > old mrp — the union of `mrpSynced` and `blockingMrpConflicts`. */
  mrpConflicts: PlannedPriceUpdate[];
  /** Conflicts auto-resolved by the zero-markdown MRP-sync exception (old sellingPrice === old mrp) — apply() raises their MRP, does not block. */
  mrpSynced: PlannedPriceUpdate[];
  /** Conflicts NOT covered by the exception (old sellingPrice !== old mrp) — apply() still refuses to write ANYTHING while any of these exist. */
  blockingMrpConflicts: PlannedPriceUpdate[];
  alreadyApplied: boolean;
};

/**
 * Splits a tax-inclusive price into its taxable value and back again with
 * a flat percentage increase applied to the taxable portion — the
 * business formula from the migration spec, generalized across both
 * TaxCalcMode values so a record that happens to be EXCLUDE_WITH_PRICE
 * (none exist in the current Katra/Royal data, but the code must not
 * silently mishandle one) is still correct: its stored price already IS
 * the taxable value, so the increase applies directly with no
 * extraction/reapplication step.
 *
 * Never rounds `rawNewTaxable` before computing `rawNewPrice` — the final
 * multiplication happens on the full-precision Decimal chain, which is
 * what makes ₹1,000 @ 18%, +3% reproduce exactly ₹1,030.00 instead of
 * ₹1,029.9984 from rounding the intermediate taxable value first.
 * `oldTaxableValue`/`newTaxableValue` in the return value ARE rounded —
 * they're display-only breakdown figures for the audit report, never fed
 * back into further arithmetic.
 */
export function computePriceIncrease(
  oldSellingPrice: number,
  taxPercent: number,
  taxCalcMode: TaxCalcMode,
  increasePercent: number,
): { oldTaxableValue: number; newTaxableValue: number; newSellingPrice: number } {
  const priceDecimal = toDecimal(oldSellingPrice);
  const increaseMultiplier = new Prisma.Decimal(1).add(new Prisma.Decimal(increasePercent).div(100));

  if (taxCalcMode === "EXCLUDE_WITH_PRICE") {
    const rawNewTaxable = priceDecimal.mul(increaseMultiplier);
    const newTaxable = decimalToMoney(rawNewTaxable);
    return { oldTaxableValue: decimalToMoney(priceDecimal), newTaxableValue: newTaxable, newSellingPrice: newTaxable };
  }

  const taxMultiplier = new Prisma.Decimal(1).add(new Prisma.Decimal(taxPercent).div(100));
  const rawTaxable = taxMultiplier.isZero() ? priceDecimal : priceDecimal.div(taxMultiplier);
  const rawNewTaxable = rawTaxable.mul(increaseMultiplier);
  const rawNewPrice = rawNewTaxable.mul(taxMultiplier);

  return {
    oldTaxableValue: decimalToMoney(rawTaxable),
    newTaxableValue: decimalToMoney(rawNewTaxable),
    newSellingPrice: decimalToMoney(rawNewPrice),
  };
}

function isValidMoney(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Resolves the MRP-conflict fields for one planned update. The zero-markdown
 * exception (old sellingPrice === old MRP) is the ONLY case where a conflict
 * doesn't block: there, `newMrp` is raised to the new selling price so the
 * record's markdown stays exactly zero. Every other conflict cause leaves
 * `mrpSyncApplied` false, so `planBulkPriceUpdate` files it under
 * `blockingMrpConflicts` and apply() refuses the whole run. Equality is
 * checked on the raw Prisma.Decimals, not their Number() forms, so a value
 * like 355.00 stored as Decimal(65,30) still compares exactly.
 */
function resolveMrpOutcome(
  oldSellingPrice: Prisma.Decimal,
  oldMrp: Prisma.Decimal,
  newSellingPrice: number,
): { mrp: number; newMrp: number; mrpConflict: boolean; mrpSyncApplied: boolean } {
  const oldMrpNum = Number(oldMrp);
  const mrpConflict = newSellingPrice > oldMrpNum;
  const mrpSyncApplied = mrpConflict && oldSellingPrice.equals(oldMrp);
  return {
    mrp: oldMrpNum,
    newMrp: mrpSyncApplied ? newSellingPrice : oldMrpNum,
    mrpConflict,
    mrpSyncApplied,
  };
}

type ScannedProduct = {
  id: string;
  name: string;
  taxPercent: Prisma.Decimal;
  customerConfig: { sellingPrice: Prisma.Decimal; mrp: Prisma.Decimal; taxCalcMode: TaxCalcMode } | null;
  dealerConfig: { sellingPrice: Prisma.Decimal; mrp: Prisma.Decimal; taxCalcMode: TaxCalcMode } | null;
  variants: {
    id: string;
    sku: string;
    audience: BulkPriceUpdateAudience;
    sellingPrice: Prisma.Decimal;
    mrp: Prisma.Decimal;
    taxCalcMode: TaxCalcMode;
  }[];
};

function baseFields(
  scope: SellerScope,
  product: { id: string; name: string },
  variantId: string | null,
  variantSku: string | null,
) {
  return {
    sellerId: scope.sellerId,
    sellerLabel: scope.label,
    productId: product.id,
    productName: product.name,
    variantId,
    variantSku,
  };
}

function scanProduct(
  scope: SellerScope,
  product: ScannedProduct,
): {
  updates: PlannedPriceUpdate[];
  skipped: SkippedOrRejectedRecord[];
  rejected: SkippedOrRejectedRecord[];
} {
  const updates: PlannedPriceUpdate[] = [];
  const skipped: SkippedOrRejectedRecord[] = [];
  const rejected: SkippedOrRejectedRecord[] = [];

  const taxPercent = Number(product.taxPercent);
  const taxPercentValid = isValidMoney(taxPercent);
  const hasVariants = product.variants.length > 0;

  const configsByAudience: [BulkPriceUpdateAudience, ScannedProduct["customerConfig"]][] = [
    ["CUSTOMER", product.customerConfig],
    ["DEALER", product.dealerConfig],
  ];

  for (const [audience, config] of configsByAudience) {
    if (!config) continue; // this audience simply doesn't apply to this product — not a rejection
    const kind: PriceRecordKind = hasVariants ? "VARIANT_BASE_CONFIG" : "NO_VARIANT_CONFIG";
    const fields = baseFields(scope, product, null, null);
    const mrp = Number(config.mrp);
    const price = Number(config.sellingPrice);

    if (hasVariants && mrp <= 0) {
      skipped.push({
        kind,
        audience,
        ...fields,
        reason:
          "Variant product's base config has no real \"Display on product card\" price set (mrp = 0) — not shown anywhere (the card falls back to the default variant's own price instead), so not updated.",
      });
      continue;
    }
    if (!taxPercentValid) {
      rejected.push({ kind, audience, ...fields, reason: `Invalid/missing taxPercent (${product.taxPercent.toString()}).` });
      continue;
    }
    if (!isValidMoney(price)) {
      rejected.push({ kind, audience, ...fields, reason: `Invalid/missing sellingPrice (${config.sellingPrice.toString()}).` });
      continue;
    }
    if (price === 0) {
      skipped.push({
        kind,
        audience,
        ...fields,
        reason:
          "sellingPrice is 0 — no real price is set on this record, so a percentage increase is meaningless; not updated (same handling as a variant product's unset card price).",
      });
      continue;
    }
    if (!isValidMoney(mrp)) {
      rejected.push({ kind, audience, ...fields, reason: `Invalid/missing mrp (${config.mrp.toString()}).` });
      continue;
    }
    const increasePercent = INCREASE_PERCENT[audience];
    const calc = computePriceIncrease(price, taxPercent, config.taxCalcMode, increasePercent);
    updates.push({
      kind,
      audience,
      ...fields,
      taxPercent,
      taxCalcMode: config.taxCalcMode,
      oldSellingPrice: price,
      oldTaxableValue: calc.oldTaxableValue,
      increasePercent,
      newTaxableValue: calc.newTaxableValue,
      newSellingPrice: calc.newSellingPrice,
      ...resolveMrpOutcome(config.sellingPrice, config.mrp, calc.newSellingPrice),
    });
  }

  for (const variant of product.variants) {
    const fields = baseFields(scope, product, variant.id, variant.sku);
    const mrp = Number(variant.mrp);
    const price = Number(variant.sellingPrice);

    if (!taxPercentValid) {
      rejected.push({ kind: "VARIANT", audience: variant.audience, ...fields, reason: `Invalid/missing taxPercent (${product.taxPercent.toString()}).` });
      continue;
    }
    if (!isValidMoney(price)) {
      rejected.push({ kind: "VARIANT", audience: variant.audience, ...fields, reason: `Invalid/missing sellingPrice (${variant.sellingPrice.toString()}).` });
      continue;
    }
    if (price === 0) {
      skipped.push({
        kind: "VARIANT",
        audience: variant.audience,
        ...fields,
        reason:
          "sellingPrice is 0 — no real price is set on this variant, so a percentage increase is meaningless; not updated.",
      });
      continue;
    }
    if (!isValidMoney(mrp)) {
      rejected.push({ kind: "VARIANT", audience: variant.audience, ...fields, reason: `Invalid/missing mrp (${variant.mrp.toString()}).` });
      continue;
    }
    const increasePercent = INCREASE_PERCENT[variant.audience];
    const calc = computePriceIncrease(price, taxPercent, variant.taxCalcMode, increasePercent);
    updates.push({
      kind: "VARIANT",
      audience: variant.audience,
      ...fields,
      taxPercent,
      taxCalcMode: variant.taxCalcMode,
      oldSellingPrice: price,
      oldTaxableValue: calc.oldTaxableValue,
      increasePercent,
      newTaxableValue: calc.newTaxableValue,
      newSellingPrice: calc.newSellingPrice,
      ...resolveMrpOutcome(variant.sellingPrice, variant.mrp, calc.newSellingPrice),
    });
  }

  return { updates, skipped, rejected };
}

/**
 * Read-only scan + calculation — never writes anything. Safe to call
 * repeatedly (e.g. for the dry-run report) with no side effects. `marker`
 * — see isBulkPriceUpdateAlreadyApplied's doc comment — defaults to the
 * real migration marker; only ever overridden by this module's own tests.
 */
export async function planBulkPriceUpdate(
  sellers: SellerScope[],
  marker: MigrationMarker = BULK_PRICE_UPDATE_MARKER,
): Promise<BulkPriceUpdatePlan> {
  const alreadyApplied = await isBulkPriceUpdateAlreadyApplied(marker);

  let productsExamined = 0;
  let variantsExamined = 0;
  const updates: PlannedPriceUpdate[] = [];
  const skipped: SkippedOrRejectedRecord[] = [];
  const rejected: SkippedOrRejectedRecord[] = [];

  for (const scope of sellers) {
    const products = await prisma.product.findMany({
      // APPROVED only — a one-time live-price increase never rewrites the
      // price of a product that's been pulled from sale (see the module
      // doc comment). Some Katra/Royal products were deactivated right
      // before this migration was resumed.
      where: { sellerId: scope.sellerId, lifecycleStatus: "APPROVED" },
      select: {
        id: true,
        name: true,
        taxPercent: true,
        customerConfig: { select: { sellingPrice: true, mrp: true, taxCalcMode: true } },
        dealerConfig: { select: { sellingPrice: true, mrp: true, taxCalcMode: true } },
        variants: {
          select: { id: true, sku: true, audience: true, sellingPrice: true, mrp: true, taxCalcMode: true },
        },
      },
    });
    productsExamined += products.length;
    for (const product of products) {
      variantsExamined += product.variants.length;
      const result = scanProduct(scope, product);
      updates.push(...result.updates);
      skipped.push(...result.skipped);
      rejected.push(...result.rejected);
    }
  }

  const affectedProductIds = new Set(updates.map((u) => u.productId));
  const variantsAffected = updates.filter((u) => u.kind === "VARIANT").length;
  const customerPricesPlanned = updates.filter((u) => u.audience === "CUSTOMER").length;
  const dealerPricesPlanned = updates.filter((u) => u.audience === "DEALER").length;
  const mrpConflicts = updates.filter((u) => u.mrpConflict);
  const mrpSynced = updates.filter((u) => u.mrpSyncApplied);
  const blockingMrpConflicts = updates.filter((u) => u.mrpConflict && !u.mrpSyncApplied);

  return {
    sellers,
    productsExamined,
    productsAffected: affectedProductIds.size,
    variantsExamined,
    variantsAffected,
    customerPricesPlanned,
    dealerPricesPlanned,
    updates,
    skipped,
    rejected,
    mrpConflicts,
    mrpSynced,
    blockingMrpConflicts,
    alreadyApplied,
  };
}

export type ApplyBulkPriceUpdateResult = { ok: true; updatedCount: number } | { ok: false; error: string };

/**
 * The only function in this module that writes anything. Refuses outright
 * (writes NOTHING, not even the non-conflicting records) if:
 *   - the audit marker already exists (this exact migration ran before), or
 *   - any planned update is a BLOCKING MRP conflict — one where the new
 *     price exceeds the old MRP and old sellingPrice !== old MRP, i.e. not
 *     covered by the zero-markdown MRP-sync exception (see the module doc
 *     comment). A zero-markdown conflict does NOT block: its row's MRP is
 *     raised to the new sellingPrice in the same transaction.
 * Both checks are re-verified fresh right here, not just trusted from
 * whatever `plan` the caller happens to be holding, since time may have
 * passed since planBulkPriceUpdate built it (a caller must always
 * re-plan immediately before calling apply, but this defends against that
 * discipline slipping too).
 *
 * All writes — every price update, every MRP-sync bump, plus the audit
 * marker row — happen inside one transaction, so a mid-run failure leaves
 * nothing partially applied.
 */
export async function applyBulkPriceUpdate(
  plan: BulkPriceUpdatePlan,
  actorId: string,
  marker: MigrationMarker = BULK_PRICE_UPDATE_MARKER,
): Promise<ApplyBulkPriceUpdateResult> {
  if (await isBulkPriceUpdateAlreadyApplied(marker)) {
    return {
      ok: false,
      error: "This migration's audit marker already exists — it has already been applied. Refusing to run again.",
    };
  }
  if (plan.blockingMrpConflicts.length > 0) {
    return {
      ok: false,
      error: `${plan.blockingMrpConflicts.length} record(s) would exceed their own MRP after the increase and are NOT zero-markdown (old sellingPrice !== old MRP) — refusing to apply ANYTHING until resolved (see plan.blockingMrpConflicts).`,
    };
  }
  if (plan.updates.length === 0) {
    return { ok: false, error: "No price updates are planned — nothing to apply." };
  }

  await prisma.$transaction(async (tx) => {
    for (const u of plan.updates) {
      // Write the price as a fixed 2-decimal STRING, never the raw JS
      // number: `newSellingPrice`/`newMrp` are rounded to 2dp
      // mathematically, but a value like 9640.80 has no exact float64
      // representation, and the pg driver serialises the number at ~16
      // significant digits — persisting 9640.799999999999 into the
      // Decimal column. `.toFixed(2)` hands Prisma the exact decimal text.
      // Only a zero-markdown conflict row carries its MRP up with the
      // price; every other row's `newMrp === mrp`, so this leaves MRP
      // untouched.
      const data = u.mrpSyncApplied
        ? { sellingPrice: u.newSellingPrice.toFixed(2), mrp: u.newMrp.toFixed(2) }
        : { sellingPrice: u.newSellingPrice.toFixed(2) };
      if (u.kind === "VARIANT") {
        await tx.productVariant.update({ where: { id: u.variantId! }, data });
      } else if (u.audience === "CUSTOMER") {
        await tx.productCustomerConfig.update({ where: { productId: u.productId }, data });
      } else {
        await tx.productDealerConfig.update({ where: { productId: u.productId }, data });
      }
    }
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole: "ADMIN",
        action: marker.action,
        entityType: marker.entityType,
        entityId: marker.entityId,
        metadata: {
          sellers: plan.sellers,
          updatedCount: plan.updates.length,
          customerPricesUpdated: plan.customerPricesPlanned,
          dealerPricesUpdated: plan.dealerPricesPlanned,
          mrpSyncedCount: plan.mrpSynced.length,
          skippedCount: plan.skipped.length,
          rejectedCount: plan.rejected.length,
        },
      },
    });
  });

  return { ok: true, updatedCount: plan.updates.length };
}
