"use server";

import { prisma } from "@kisan4u/db";
import {
  recordStockChange,
  listStockAdjustments,
  updateStockThresholds,
  type StockTarget,
} from "@kisan4u/catalog";
import { revalidatePath } from "next/cache";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

function isSafeTarget(target: StockTarget): boolean {
  if (target.kind === "variant") return /^[a-zA-Z0-9_-]{1,64}$/.test(target.variantId);
  return (
    /^[a-zA-Z0-9_-]{1,64}$/.test(target.productId) &&
    (target.audience === "CUSTOMER" || target.audience === "DEALER")
  );
}

export async function sellerAddStockAction(
  target: StockTarget,
  quantity: number,
  note: string | null,
) {
  const { session, sellerProfileId } = await requireApprovedSeller();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false as const, error: "Enter a positive whole number." };
  }
  const result = await prisma.$transaction((tx) =>
    recordStockChange(tx, {
      target,
      change: { mode: "delta", delta: quantity },
      adjustmentType: "MANUAL_ADD",
      sourceType: "SELLER",
      reason: note?.trim() || null,
      performedBy: { id: session.user.id, role: "SELLER" },
      expectedSellerId: sellerProfileId,
    }),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath("/seller/product-quantity");
  return { ok: true as const };
}

export async function sellerSetStockAction(
  target: StockTarget,
  newQty: number,
  expectedPreviousQty: number,
  reason: string,
) {
  const { session, sellerProfileId } = await requireApprovedSeller();
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
      adjustmentType: "MANUAL_CORRECTION",
      sourceType: "SELLER",
      reason: reason.trim(),
      performedBy: { id: session.user.id, role: "SELLER" },
      expectedSellerId: sellerProfileId,
    }),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath("/seller/product-quantity");
  return { ok: true as const };
}

export async function sellerEditThresholdsAction(
  target: StockTarget,
  minStockQty: number,
  reorderLevel: number,
) {
  const { sellerProfileId } = await requireApprovedSeller();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  const result = await updateStockThresholds(
    target,
    { minStockQty, reorderLevel },
    sellerProfileId,
  );
  if (!result.ok) return result;
  revalidatePath("/seller/product-quantity");
  return { ok: true as const };
}

export async function sellerListStockHistoryAction(target: StockTarget, page: number) {
  const { sellerProfileId } = await requireApprovedSeller();
  if (!isSafeTarget(target)) return { ok: false as const, error: "Invalid target." };
  const result = await listStockAdjustments(target, {
    expectedSellerId: sellerProfileId,
    page,
    pageSize: 20,
  });
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
