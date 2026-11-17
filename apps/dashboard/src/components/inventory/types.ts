export type StockTargetInput =
  | { kind: "variant"; variantId: string }
  | { kind: "base"; productId: string; audience: "CUSTOMER" | "DEALER" };

export type InventoryRowDTO = {
  key: string;
  productId: string;
  productName: string;
  productSlug: string;
  imageUrl: string;
  variantId: string | null;
  variantLabel: string;
  sku: string;
  hsnCode: string;
  sellerId: string;
  sellerName: string;
  audience: "CUSTOMER" | "DEALER";
  onHandQty: number;
  availableQty: number;
  minStockQty: number;
  reorderLevel: number;
  stockStatus: { status: string; label: string; tone: "danger" | "warning" | "success" };
  updatedAt: string;
  productStatus: string;
  /** ACTIVE RestockSubscription count for this exact variant/audience — "N waiting" shown on an out-of-stock row. */
  waitingCount: number;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export type StockAdjustmentRowDTO = {
  id: string;
  previousQty: number;
  changeQty: number;
  newQty: number;
  adjustmentType: string;
  sourceType: string;
  reason: string | null;
  relatedOrderId: string | null;
  performedByName: string | null;
  performedByRole: string;
  createdAt: string;
};

export type InventoryActions = {
  addStock: (
    target: StockTargetInput,
    quantity: number,
    note: string | null,
  ) => Promise<ActionResult>;
  setStock: (
    target: StockTargetInput,
    newQty: number,
    expectedPreviousQty: number,
    reason: string,
  ) => Promise<ActionResult>;
  editThresholds: (
    target: StockTargetInput,
    minStockQty: number,
    reorderLevel: number,
  ) => Promise<ActionResult>;
  listHistory: (
    target: StockTargetInput,
    page: number,
  ) => Promise<
    { ok: true; rows: StockAdjustmentRowDTO[]; total: number } | { ok: false; error: string }
  >;
  /** Admin-only "Bulk update" flow — undefined on the seller-side inventory page, which has no bulk action. */
  bulkPreview?: (
    lines: { sku: string; newQty: number }[],
  ) => Promise<{ ok: true; rows: BulkStockPreviewRowDTO[] } | { ok: false; error: string }>;
  bulkApply?: (
    rows: { target: StockTargetInput; newQty: number }[],
  ) => Promise<{
    ok: true;
    appliedCount: number;
    failures: { target: StockTargetInput; error: string }[];
  }>;
};

export type BulkStockPreviewRowDTO = {
  sku: string;
  valid: boolean;
  error?: string;
  productName?: string;
  variantLabel?: string;
  audience?: "CUSTOMER" | "DEALER";
  currentQty?: number;
  newQty: number;
  target?: StockTargetInput;
};

export const ADJUSTMENT_TYPE_LABEL: Record<string, string> = {
  MANUAL_ADD: "Manual addition",
  MANUAL_CORRECTION: "Manual correction",
  ORDER_SALE: "Order sale",
  ORDER_CANCELLATION_RESTORE: "Order cancellation restore",
  RETURN_RESTORE: "Return restore",
  ADMIN_CORRECTION: "Admin correction",
  MIGRATION_OPENING_BALANCE: "Migration / opening balance",
};

export function rowTarget(row: InventoryRowDTO): StockTargetInput {
  return row.variantId
    ? { kind: "variant", variantId: row.variantId }
    : { kind: "base", productId: row.productId, audience: row.audience };
}
