"use server";

import { prisma } from "@kisan4u/db";
import {
  recordStockChange,
  listStockAdjustments,
  updateStockThresholds,
  findInventoryTargetBySku,
  type StockTarget,
} from "@kisan4u/catalog";
import { revalidatePath } from "next/cache";
import { requireInventoryAccess } from "@/lib/inventory-guard";

function isSafeTarget(target: StockTarget): boolean {
  if (target.kind === "variant") return /^[a-zA-Z0-9_-]{1,64}$/.test(target.variantId);
  return (
    /^[a-zA-Z0-9_-]{1,64}$/.test(target.productId) &&
    (target.audience === "CUSTOMER" || target.audience === "DEALER")
  );
}

export async function adminAddStockAction(
  target: StockTarget,
  quantity: number,
  note: string | null,
) {
  const session = await requireInventoryAccess();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false as const, error: "Enter a positive whole number." };
  }
  const result = await prisma.$transaction((tx) =>
    recordStockChange(tx, {
      target,
      change: { mode: "delta", delta: quantity },
      adjustmentType: "MANUAL_ADD",
      sourceType: "ADMIN",
      reason: note?.trim() || null,
      performedBy: { id: session.user.id, role: "ADMIN" },
    }),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath("/admin/product-quantity");
  return { ok: true as const };
}

export async function adminSetStockAction(
  target: StockTarget,
  newQty: number,
  expectedPreviousQty: number,
  reason: string,
) {
  const session = await requireInventoryAccess();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  if (!reason.trim())
    return { ok: false as const, error: "A reason is required for a stock correction." };
  if (!Number.isInteger(newQty) || newQty < 0) {
    return { ok: false as const, error: "Enter a whole number that is zero or greater." };
  }
  const result = await prisma.$transaction((tx) =>
    recordStockChange(tx, {
      target,
      change: { mode: "set", newQty, expectedPreviousQty },
      adjustmentType: "ADMIN_CORRECTION",
      sourceType: "ADMIN",
      reason: reason.trim(),
      performedBy: { id: session.user.id, role: "ADMIN" },
    }),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath("/admin/product-quantity");
  return { ok: true as const };
}

export async function adminEditThresholdsAction(
  target: StockTarget,
  minStockQty: number,
  reorderLevel: number,
) {
  await requireInventoryAccess();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  const result = await updateStockThresholds(target, { minStockQty, reorderLevel });
  if (!result.ok) return result;
  revalidatePath("/admin/product-quantity");
  return { ok: true as const };
}

export type BulkStockLine = { sku: string; newQty: number };
export type BulkStockPreviewRow = {
  sku: string;
  valid: boolean;
  error?: string;
  productName?: string;
  variantLabel?: string;
  audience?: "CUSTOMER" | "DEALER";
  currentQty?: number;
  newQty: number;
  target?: StockTarget;
};

const BULK_STOCK_MAX_ROWS = 200;

/** Validation-and-preview pass — never writes anything. Looks up each pasted SKU and reports what would change, so the admin can review before Apply actually calls recordStockChange (same convention as the single-row Set/correct modal, just N rows at once). */
export async function adminPreviewBulkStockAction(
  lines: BulkStockLine[],
): Promise<{ ok: true; rows: BulkStockPreviewRow[] } | { ok: false; error: string }> {
  await requireInventoryAccess();
  if (lines.length === 0) return { ok: false, error: "Nothing to preview." };
  if (lines.length > BULK_STOCK_MAX_ROWS) {
    return { ok: false, error: `A bulk update is limited to ${BULK_STOCK_MAX_ROWS} rows at a time.` };
  }

  const rows: BulkStockPreviewRow[] = [];
  for (const line of lines) {
    const sku = line.sku.trim();
    if (!sku) {
      rows.push({ sku: line.sku, valid: false, error: "Blank SKU", newQty: line.newQty });
      continue;
    }
    if (!Number.isInteger(line.newQty) || line.newQty < 0) {
      rows.push({ sku, valid: false, error: "Quantity must be a whole number ≥ 0", newQty: line.newQty });
      continue;
    }
    const found = await findInventoryTargetBySku(sku);
    if (!found) {
      rows.push({ sku, valid: false, error: "SKU not found", newQty: line.newQty });
      continue;
    }
    rows.push({
      sku,
      valid: true,
      productName: found.productName,
      variantLabel: found.variantLabel,
      audience: found.audience,
      currentQty: found.currentQty,
      newQty: line.newQty,
      target: found.target,
    });
  }
  return { ok: true, rows };
}

/** Applies a previously-previewed bulk update — each row goes through the exact same recordStockChange choke point as a single "Set / correct quantity", one adjustment ledger row per SKU, `sourceType: "ADMIN"` with a shared "Bulk update" reason. Re-validates each target server-side rather than trusting the client's preview snapshot (the underlying quantity may have moved between preview and apply). */
export async function adminApplyBulkStockAction(
  rows: { target: StockTarget; newQty: number }[],
): Promise<{ ok: true; appliedCount: number; failures: { target: StockTarget; error: string }[] }> {
  const session = await requireInventoryAccess();
  const failures: { target: StockTarget; error: string }[] = [];
  let appliedCount = 0;

  for (const row of rows) {
    if (!isSafeTarget(row.target) || !Number.isInteger(row.newQty) || row.newQty < 0) {
      failures.push({ target: row.target, error: "Invalid row — skipped." });
      continue;
    }
    // Re-read the current quantity right before writing — recordStockChange
    // requires expectedPreviousQty for a "set", and using a stale value
    // from the client's preview would spuriously fail if anything else
    // touched this SKU in between.
    const current =
      row.target.kind === "variant"
        ? await prisma.productVariant.findUnique({
            where: { id: row.target.variantId },
            select: { stockQty: true },
          })
        : row.target.audience === "CUSTOMER"
          ? await prisma.productCustomerConfig.findUnique({
              where: { productId: row.target.productId },
              select: { currentStock: true },
            })
          : await prisma.productDealerConfig.findUnique({
              where: { productId: row.target.productId },
              select: { currentStock: true },
            });
    if (!current) {
      failures.push({ target: row.target, error: "No longer exists." });
      continue;
    }
    const expectedPreviousQty = "stockQty" in current ? current.stockQty : current.currentStock;
    const result = await prisma.$transaction((tx) =>
      recordStockChange(tx, {
        target: row.target,
        change: { mode: "set", newQty: row.newQty, expectedPreviousQty },
        adjustmentType: "ADMIN_CORRECTION",
        sourceType: "ADMIN",
        reason: "Bulk update",
        performedBy: { id: session.user.id, role: "ADMIN" },
      }),
    );
    if (!result.ok) failures.push({ target: row.target, error: result.error });
    else appliedCount += 1;
  }

  if (appliedCount > 0) revalidatePath("/admin/product-quantity");
  return { ok: true, appliedCount, failures };
}

export async function adminListStockHistoryAction(target: StockTarget, page: number) {
  await requireInventoryAccess();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  const result = await listStockAdjustments(target, { page, pageSize: 20 });
  if ("ok" in result) return result;
  return {
    ok: true as const,
    rows: result.rows.map((r) => ({
      id: r.id,
      previousQty: r.previousQty,
      changeQty: r.changeQty,
      newQty: r.newQty,
      adjustmentType: r.adjustmentType,
      sourceType: r.sourceType,
      reason: r.reason,
      relatedOrderId: r.relatedOrderId,
      performedByName: r.performedByName,
      performedByRole: r.performedByRole,
      createdAt: r.createdAt.toISOString(),
    })),
    total: result.total,
  };
}
