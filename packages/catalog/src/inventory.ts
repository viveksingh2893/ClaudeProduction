import {
  prisma,
  Prisma,
  getFullName,
  type VariantAudience,
  type StockAdjustmentType,
  type StockAdjustmentSource,
  type UserRole,
} from "@kisan4u/db";

/** Same shape as packages/orders/src/stock.ts's TxClient — accepts either the top-level `prisma` client or a `$transaction` callback's `tx`, so recordStockChange can be called standalone (seller/admin actions) or nested inside an existing transaction (order checkout/cancellation). */
type TxClient = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Stock status (spec §4) — pure, no I/O, reused by the inventory table AND
// the catalogue/product-card layer for out-of-stock badges.
// ---------------------------------------------------------------------------

export type StockStatus = "OUT_OF_STOCK" | "MINIMUM_LEVEL" | "REORDER_REQUIRED" | "IN_STOCK";

export type StockStatusInfo = {
  status: StockStatus;
  label: string;
  tone: "danger" | "warning" | "success";
};

/**
 * Priority order matters — checked top to bottom, first match wins:
 *   available <= 0                        -> Out of stock (red)
 *   0 < available <= minStockQty           -> Minimum level (red)
 *   minStockQty < available <= reorderLevel -> Reorder required (yellow)
 *   available > reorderLevel               -> In stock (green)
 * At exact equality: == minStockQty is red, == reorderLevel is yellow —
 * both branches use `<=`, never `<`, so the boundary itself is captured by
 * the stricter (redder) bucket as spec §4 requires.
 */
export function computeStockStatus(
  availableQty: number,
  minStockQty: number,
  reorderLevel: number,
): StockStatusInfo {
  if (availableQty <= 0) return { status: "OUT_OF_STOCK", label: "Out of stock", tone: "danger" };
  if (availableQty <= minStockQty)
    return { status: "MINIMUM_LEVEL", label: "Minimum level", tone: "danger" };
  if (availableQty <= reorderLevel)
    return { status: "REORDER_REQUIRED", label: "Reorder required", tone: "warning" };
  return { status: "IN_STOCK", label: "In stock", tone: "success" };
}

const STOCK_STATUS_RANK: Record<StockStatus, number> = {
  OUT_OF_STOCK: 0,
  MINIMUM_LEVEL: 1,
  REORDER_REQUIRED: 2,
  IN_STOCK: 3,
};

// ---------------------------------------------------------------------------
// Stock target — the two shapes of "one inventory-holding row" in this
// schema. `variant` = a real ProductVariant row. `base` = a non-variant
// product's per-audience config row (ProductCustomerConfig/
// ProductDealerConfig) — spec's "Default variant" row. There is no
// synthetic ProductVariant ever created for the non-variant case; `base`
// addresses the config row directly.
// ---------------------------------------------------------------------------

export type StockTarget =
  | { kind: "variant"; variantId: string }
  | { kind: "base"; productId: string; audience: VariantAudience };

function targetKey(target: StockTarget): string {
  return target.kind === "variant"
    ? `variant:${target.variantId}`
    : `base:${target.productId}:${target.audience}`;
}

// ---------------------------------------------------------------------------
// Image priority (spec §1 image priority chain): variant's own image ->
// product's primary image -> null (caller renders the placeholder, same
// convention as ProductImage's built-in fallback).
// ---------------------------------------------------------------------------

export function resolveInventoryImageUrl(
  variantImageUrl: string | null | undefined,
  productPrimaryImageUrl: string,
): string {
  return variantImageUrl || productPrimaryImageUrl;
}

function variantLabelFromValues(
  values: Array<{ attributeValue: { value: string; attribute: { name: string } } }>,
): string {
  return values
    .map((v) => `${v.attributeValue.attribute.name}: ${v.attributeValue.value}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Listing — one unified row set merged from three Prisma sources (variant
// rows, customer base-config rows, dealer base-config rows), each already
// filtered at the DB level as far as each table's own columns allow.
// Computed/cross-table concerns (stock-status bucket, some sort keys) are
// applied in Node after the merge — same hybrid convention already used by
// packages/orders' listCheckoutGroupsForAdmin for its derived columns.
// ---------------------------------------------------------------------------

export type InventoryRow = {
  key: string;
  productId: string;
  productName: string;
  productSlug: string;
  imageUrl: string;
  variantId: string | null;
  variantLabel: string; // "Default variant" for a non-variant row
  sku: string;
  hsnCode: string;
  sellerId: string;
  sellerName: string;
  audience: VariantAudience;
  onHandQty: number;
  availableQty: number; // = onHandQty today — no reservation concept exists in this codebase (see report)
  minStockQty: number;
  reorderLevel: number;
  stockStatus: StockStatusInfo;
  updatedAt: Date;
  categoryId: string;
  subCategoryId: string | null;
  subSubCategoryId: string | null;
  brandId: string | null;
  productStatus: string;
  /** Count of ACTIVE RestockSubscription rows for this exact product/variant/audience — "N waiting" on an out-of-stock row. Populated only on the page listInventory actually returns (not on every row built internally), so it's cheap. */
  waitingCount?: number;
};

export type InventoryFilters = {
  sellerId?: string;
  categoryId?: string;
  subCategoryId?: string;
  subSubCategoryId?: string;
  brandId?: string;
  audience?: VariantAudience;
  stockStatus?: StockStatus;
  productStatus?: string;
  search?: string;
};

export type InventorySortKey =
  | "productName"
  | "variantName"
  | "availableQty"
  | "minStockQty"
  | "reorderLevel"
  | "stockStatus"
  | "updatedAt"
  | "seller";

export type InventoryListParams = InventoryFilters & {
  sortKey?: InventorySortKey | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

export type InventoryListResult = { rows: InventoryRow[]; total: number };

/**
 * `scope.sellerId`, when present, is a HARD restriction the caller cannot
 * widen (the seller-side page passes its own session's sellerId here,
 * never trusting `filters.sellerId`). Admin pages pass `scope: {}` and use
 * `filters.sellerId` as an optional narrowing filter instead.
 *
 * Shared by listInventory (sorted/paginated) and getInventoryStatusSummary
 * (bucket counts only) so the four underlying queries + row-shaping never
 * has to be written twice — `stockStatus` filtering deliberately happens
 * in JS, not SQL, because a row's status is a column-to-column comparison
 * (stockQty vs minStockQty/reorderLevel) that Prisma's query builder can't
 * express without raw SQL.
 */
async function buildInventoryRows(
  filters: InventoryFilters,
  scope: { sellerId?: string },
): Promise<InventoryRow[]> {
  const effectiveSellerId = scope.sellerId ?? filters.sellerId;
  const search = filters.search?.trim();

  const productWhere: Prisma.ProductWhereInput = {
    sellerId: effectiveSellerId ?? { not: null }, // in-house/no-seller products are out of scope for this feature — see report
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.subCategoryId ? { subCategoryId: filters.subCategoryId } : {}),
    ...(filters.subSubCategoryId ? { subSubCategoryId: filters.subSubCategoryId } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.productStatus ? { lifecycleStatus: filters.productStatus as never } : {}),
  };

  const variantSearchOr: Prisma.ProductVariantWhereInput[] = search
    ? [
        { sku: { contains: search, mode: "insensitive" } },
        { hsnCode: { contains: search, mode: "insensitive" } },
        { product: { name: { contains: search, mode: "insensitive" } } },
        { product: { seller: { shopName: { contains: search, mode: "insensitive" } } } },
        {
          values: {
            some: { attributeValue: { value: { contains: search, mode: "insensitive" } } },
          },
        },
      ]
    : [];
  const customerBaseSearchOr: Prisma.ProductCustomerConfigWhereInput[] = search
    ? [
        { product: { name: { contains: search, mode: "insensitive" } } },
        { product: { sku: { contains: search, mode: "insensitive" } } },
        { sku: { contains: search, mode: "insensitive" } },
        { hsnCode: { contains: search, mode: "insensitive" } },
        { product: { seller: { shopName: { contains: search, mode: "insensitive" } } } },
      ]
    : [];
  const dealerBaseSearchOr: Prisma.ProductDealerConfigWhereInput[] = search
    ? [
        { product: { name: { contains: search, mode: "insensitive" } } },
        { product: { sku: { contains: search, mode: "insensitive" } } },
        { sku: { contains: search, mode: "insensitive" } },
        { hsnCode: { contains: search, mode: "insensitive" } },
        { product: { seller: { shopName: { contains: search, mode: "insensitive" } } } },
      ]
    : [];

  const variantProductSelect = {
    id: true,
    name: true,
    slug: true,
    hsnCode: true,
    primaryImageUrl: true,
    sellerId: true,
    lifecycleStatus: true,
    categoryId: true,
    subCategoryId: true,
    subSubCategoryId: true,
    brandId: true,
    seller: { select: { shopName: true } },
  } as const;
  const variantSelect = {
    id: true,
    sku: true,
    hsnCode: true,
    stockQty: true,
    minStockQty: true,
    reorderLevel: true,
    audience: true,
    imageUrl: true,
    updatedAt: true,
    values: {
      select: {
        attributeValue: { select: { value: true, attribute: { select: { name: true } } } },
      },
    },
    product: { select: variantProductSelect },
  } as const;
  const baseProductSelect = {
    id: true,
    name: true,
    slug: true,
    sku: true,
    hsnCode: true,
    primaryImageUrl: true,
    sellerId: true,
    lifecycleStatus: true,
    categoryId: true,
    subCategoryId: true,
    subSubCategoryId: true,
    brandId: true,
    seller: { select: { shopName: true } },
  } as const;

  const [customerVariantRaw, customerBaseRaw, dealerVariantRaw, dealerBaseRaw] = await Promise.all([
    filters.audience === "DEALER"
      ? Promise.resolve([])
      : prisma.productVariant.findMany({
          where: {
            audience: "CUSTOMER",
            product: productWhere,
            ...(search ? { OR: variantSearchOr } : {}),
          },
          select: variantSelect,
        }),
    filters.audience === "DEALER"
      ? Promise.resolve([])
      : prisma.productCustomerConfig.findMany({
          where: {
            product: { ...productWhere, variants: { none: { audience: "CUSTOMER" } } },
            ...(search ? { OR: customerBaseSearchOr } : {}),
          },
          select: {
            sku: true,
            hsnCode: true,
            currentStock: true,
            minStockQty: true,
            reorderLevel: true,
            updatedAt: true,
            product: { select: baseProductSelect },
          },
        }),
    filters.audience === "CUSTOMER"
      ? Promise.resolve([])
      : prisma.productVariant.findMany({
          where: {
            audience: "DEALER",
            product: productWhere,
            ...(search ? { OR: variantSearchOr } : {}),
          },
          select: variantSelect,
        }),
    filters.audience === "CUSTOMER"
      ? Promise.resolve([])
      : prisma.productDealerConfig.findMany({
          where: {
            product: { ...productWhere, variants: { none: { audience: "DEALER" } } },
            ...(search ? { OR: dealerBaseSearchOr } : {}),
          },
          select: {
            sku: true,
            hsnCode: true,
            currentStock: true,
            minStockQty: true,
            reorderLevel: true,
            updatedAt: true,
            product: { select: baseProductSelect },
          },
        }),
  ]);
  const variantRowsRaw = [...customerVariantRaw, ...dealerVariantRaw];

  const rows: InventoryRow[] = [];

  for (const v of variantRowsRaw) {
    const status = computeStockStatus(v.stockQty, v.minStockQty, v.reorderLevel);
    rows.push({
      key: `variant:${v.id}`,
      productId: v.product.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      imageUrl: resolveInventoryImageUrl(v.imageUrl, v.product.primaryImageUrl),
      variantId: v.id,
      variantLabel: variantLabelFromValues(v.values),
      sku: v.sku,
      hsnCode: v.hsnCode ?? v.product.hsnCode,
      sellerId: v.product.sellerId!,
      sellerName: v.product.seller?.shopName ?? "—",
      audience: v.audience,
      onHandQty: v.stockQty,
      availableQty: v.stockQty,
      minStockQty: v.minStockQty,
      reorderLevel: v.reorderLevel,
      stockStatus: status,
      updatedAt: v.updatedAt,
      categoryId: v.product.categoryId,
      subCategoryId: v.product.subCategoryId,
      subSubCategoryId: v.product.subSubCategoryId,
      brandId: v.product.brandId,
      productStatus: v.product.lifecycleStatus,
    });
  }

  for (const c of customerBaseRaw) {
    const status = computeStockStatus(c.currentStock, c.minStockQty, c.reorderLevel);
    rows.push({
      key: `base:${c.product.id}:CUSTOMER`,
      productId: c.product.id,
      productName: c.product.name,
      productSlug: c.product.slug,
      imageUrl: c.product.primaryImageUrl,
      variantId: null,
      variantLabel: "Default variant",
      sku: c.sku ?? c.product.sku,
      hsnCode: c.hsnCode ?? c.product.hsnCode,
      sellerId: c.product.sellerId!,
      sellerName: c.product.seller?.shopName ?? "—",
      audience: "CUSTOMER",
      onHandQty: c.currentStock,
      availableQty: c.currentStock,
      minStockQty: c.minStockQty,
      reorderLevel: c.reorderLevel,
      stockStatus: status,
      updatedAt: c.updatedAt,
      categoryId: c.product.categoryId,
      subCategoryId: c.product.subCategoryId,
      subSubCategoryId: c.product.subSubCategoryId,
      brandId: c.product.brandId,
      productStatus: c.product.lifecycleStatus,
    });
  }

  for (const c of dealerBaseRaw) {
    const status = computeStockStatus(c.currentStock, c.minStockQty, c.reorderLevel);
    rows.push({
      key: `base:${c.product.id}:DEALER`,
      productId: c.product.id,
      productName: c.product.name,
      productSlug: c.product.slug,
      imageUrl: c.product.primaryImageUrl,
      variantId: null,
      variantLabel: "Default variant",
      sku: c.sku ?? c.product.sku,
      hsnCode: c.hsnCode ?? c.product.hsnCode,
      sellerId: c.product.sellerId!,
      sellerName: c.product.seller?.shopName ?? "—",
      audience: "DEALER",
      onHandQty: c.currentStock,
      availableQty: c.currentStock,
      minStockQty: c.minStockQty,
      reorderLevel: c.reorderLevel,
      stockStatus: status,
      updatedAt: c.updatedAt,
      categoryId: c.product.categoryId,
      subCategoryId: c.product.subCategoryId,
      subSubCategoryId: c.product.subSubCategoryId,
      brandId: c.product.brandId,
      productStatus: c.product.lifecycleStatus,
    });
  }

  const filtered = filters.stockStatus
    ? rows.filter((r) => r.stockStatus.status === filters.stockStatus)
    : rows;

  return filtered;
}

export async function listInventory(
  filters: InventoryListParams,
  scope: { sellerId?: string },
): Promise<InventoryListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const filtered = await buildInventoryRows(filters, scope);

  const dir = filters.sortDir === "asc" ? 1 : -1;
  const sortKey = filters.sortKey ?? "updatedAt";
  filtered.sort((a, b) => {
    switch (sortKey) {
      case "productName":
        return dir * a.productName.localeCompare(b.productName);
      case "variantName":
        return dir * a.variantLabel.localeCompare(b.variantLabel);
      case "availableQty":
        return dir * (a.availableQty - b.availableQty);
      case "minStockQty":
        return dir * (a.minStockQty - b.minStockQty);
      case "reorderLevel":
        return dir * (a.reorderLevel - b.reorderLevel);
      case "stockStatus":
        return (
          dir * (STOCK_STATUS_RANK[a.stockStatus.status] - STOCK_STATUS_RANK[b.stockStatus.status])
        );
      case "seller":
        return dir * a.sellerName.localeCompare(b.sellerName);
      case "updatedAt":
      default:
        return dir * (a.updatedAt.getTime() - b.updatedAt.getTime());
    }
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  // "N waiting" enrichment — only for the page actually returned, keyed
  // by the exact (productId, variantId, audience) tuple a restock
  // subscription is unique on.
  const waiting = await prisma.restockSubscription.groupBy({
    by: ["productId", "variantId", "audience"],
    where: {
      status: "ACTIVE",
      OR: pageRows.map((r) => ({
        productId: r.productId,
        variantId: r.variantId ?? "",
        audience: r.audience,
      })),
    },
    _count: true,
  });
  const waitingByKey = new Map(
    waiting.map((w) => [`${w.productId}:${w.variantId}:${w.audience}`, w._count]),
  );
  for (const r of pageRows) {
    r.waitingCount = waitingByKey.get(`${r.productId}:${r.variantId ?? ""}:${r.audience}`) ?? 0;
  }

  return { rows: pageRows, total };
}

export type InventoryStatusSummary = {
  trackedVariants: number;
  healthy: number;
  reorder: number;
  minimum: number;
  outOfStock: number;
  /** Total ACTIVE RestockSubscription rows across every tracked variant in this scope — "N customers and dealers are waiting". */
  waitingSubscribers: number;
  /** Distinct (product, variant, audience) tuples that have at least one waiting subscriber — "...across N variants". */
  waitingVariantCount: number;
};

/** Powers the Inventory Management page's stat cards (and the Products page's "Stock Attention" card) — reuses buildInventoryRows so the bucket counts always agree with what listInventory's own tabs/filters would return. */
export async function getInventoryStatusSummary(
  filters: InventoryFilters,
  scope: { sellerId?: string },
): Promise<InventoryStatusSummary> {
  // stockStatus is a tab/filter the summary itself must ignore — it always
  // reports every bucket's count regardless of which one the caller has
  // currently selected.
  const { stockStatus: _ignored, ...rest } = filters;
  const rows = await buildInventoryRows(rest, scope);
  const counts = { healthy: 0, reorder: 0, minimum: 0, outOfStock: 0 };
  for (const r of rows) {
    if (r.stockStatus.status === "IN_STOCK") counts.healthy += 1;
    else if (r.stockStatus.status === "REORDER_REQUIRED") counts.reorder += 1;
    else if (r.stockStatus.status === "MINIMUM_LEVEL") counts.minimum += 1;
    else counts.outOfStock += 1;
  }

  let waitingSubscribers = 0;
  let waitingVariantCount = 0;
  if (rows.length > 0) {
    const waiting = await prisma.restockSubscription.groupBy({
      by: ["productId", "variantId", "audience"],
      where: {
        status: "ACTIVE",
        OR: rows.map((r) => ({
          productId: r.productId,
          variantId: r.variantId ?? "",
          audience: r.audience,
        })),
      },
      _count: true,
    });
    waitingVariantCount = waiting.length;
    waitingSubscribers = waiting.reduce((sum, w) => sum + w._count, 0);
  }

  return { trackedVariants: rows.length, ...counts, waitingSubscribers, waitingVariantCount };
}

export type SkuLookupResult = {
  target: StockTarget;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  audience: VariantAudience;
  currentQty: number;
  minStockQty: number;
  reorderLevel: number;
};

/**
 * Resolves one inventory row by its displayed SKU — the bulk-update
 * flow's per-line lookup (admin pastes SKU + new quantity, one line at a
 * time; this is what turns a SKU into the StockTarget recordStockChange
 * needs). Checks a variant's own sku first, then each base config's own
 * sku, then falls back to the parent Product.sku for a base config that
 * predates the per-audience SKU convention (see ProductCustomerConfig.sku's
 * doc comment) — preferring the customer config when both audiences exist
 * for that fallback case, since there's no way to disambiguate from the
 * product SKU alone.
 */
export async function findInventoryTargetBySku(sku: string): Promise<SkuLookupResult | null> {
  const trimmed = sku.trim();
  if (!trimmed) return null;

  const variant = await prisma.productVariant.findFirst({
    where: { sku: trimmed },
    select: {
      id: true,
      sku: true,
      stockQty: true,
      minStockQty: true,
      reorderLevel: true,
      audience: true,
      values: {
        select: { attributeValue: { select: { value: true, attribute: { select: { name: true } } } } },
      },
      product: { select: { id: true, name: true } },
    },
  });
  if (variant) {
    return {
      target: { kind: "variant", variantId: variant.id },
      productId: variant.product.id,
      productName: variant.product.name,
      variantLabel: variantLabelFromValues(variant.values),
      sku: variant.sku,
      audience: variant.audience,
      currentQty: variant.stockQty,
      minStockQty: variant.minStockQty,
      reorderLevel: variant.reorderLevel,
    };
  }

  const customerConfig = await prisma.productCustomerConfig.findFirst({
    where: { sku: trimmed },
    select: {
      currentStock: true,
      minStockQty: true,
      reorderLevel: true,
      product: { select: { id: true, name: true } },
    },
  });
  if (customerConfig) {
    return {
      target: { kind: "base", productId: customerConfig.product.id, audience: "CUSTOMER" },
      productId: customerConfig.product.id,
      productName: customerConfig.product.name,
      variantLabel: "Default variant",
      sku: trimmed,
      audience: "CUSTOMER",
      currentQty: customerConfig.currentStock,
      minStockQty: customerConfig.minStockQty,
      reorderLevel: customerConfig.reorderLevel,
    };
  }

  const dealerConfig = await prisma.productDealerConfig.findFirst({
    where: { sku: trimmed },
    select: {
      currentStock: true,
      minStockQty: true,
      reorderLevel: true,
      product: { select: { id: true, name: true } },
    },
  });
  if (dealerConfig) {
    return {
      target: { kind: "base", productId: dealerConfig.product.id, audience: "DEALER" },
      productId: dealerConfig.product.id,
      productName: dealerConfig.product.name,
      variantLabel: "Default variant",
      sku: trimmed,
      audience: "DEALER",
      currentQty: dealerConfig.currentStock,
      minStockQty: dealerConfig.minStockQty,
      reorderLevel: dealerConfig.reorderLevel,
    };
  }

  // Fallback: a base config created before per-audience SKUs were
  // required — its own `sku` column is null and the product list falls
  // back to displaying Product.sku instead (see the row-building loops
  // above). Matches customer first, then dealer.
  const product = await prisma.product.findFirst({
    where: { sku: trimmed },
    select: {
      id: true,
      name: true,
      customerConfig: { select: { currentStock: true, minStockQty: true, reorderLevel: true, sku: true } },
      dealerConfig: { select: { currentStock: true, minStockQty: true, reorderLevel: true, sku: true } },
    },
  });
  if (product?.customerConfig && !product.customerConfig.sku) {
    return {
      target: { kind: "base", productId: product.id, audience: "CUSTOMER" },
      productId: product.id,
      productName: product.name,
      variantLabel: "Default variant",
      sku: trimmed,
      audience: "CUSTOMER",
      currentQty: product.customerConfig.currentStock,
      minStockQty: product.customerConfig.minStockQty,
      reorderLevel: product.customerConfig.reorderLevel,
    };
  }
  if (product?.dealerConfig && !product.dealerConfig.sku) {
    return {
      target: { kind: "base", productId: product.id, audience: "DEALER" },
      productId: product.id,
      productName: product.name,
      variantLabel: "Default variant",
      sku: trimmed,
      audience: "DEALER",
      currentQty: product.dealerConfig.currentStock,
      minStockQty: product.dealerConfig.minStockQty,
      reorderLevel: product.dealerConfig.reorderLevel,
    };
  }

  return null;
}

/** Count of StockAdjustment rows created since local midnight — "N stock adjustments were made today". `sellerId` scopes to one seller (the seller-side inventory page); omit for the whole platform (admin). */
export async function countStockAdjustmentsToday(sellerId?: string): Promise<number> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return prisma.stockAdjustment.count({
    where: { createdAt: { gte: midnight }, ...(sellerId ? { sellerId } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Mutation — the single choke point every stock-quantity change in the
// app routes through (manual seller/admin adjustments AND order sale/
// cancellation deductions, see packages/orders/src/stock.ts). Every call
// writes exactly one StockAdjustment ledger row and, when the change
// crosses the out-of-stock -> in-stock boundary, triggers restock
// notifications — all inside the same transaction as the quantity write,
// so a rollback anywhere (including a failed guard) never leaves a
// dangling ledger row or a false alert.
// ---------------------------------------------------------------------------

export type StockChangeSpec =
  { mode: "delta"; delta: number } | { mode: "set"; newQty: number; expectedPreviousQty: number };

export type RecordStockChangeParams = {
  target: StockTarget;
  change: StockChangeSpec;
  adjustmentType: StockAdjustmentType;
  sourceType: StockAdjustmentSource;
  reason?: string | null;
  relatedOrderId?: string | null;
  performedBy: { id: string; role: UserRole };
  /** When set, the target's product must belong to this seller or the change is refused untouched — the seller-scoped action layer's real enforcement point, not just a UI convenience. */
  expectedSellerId?: string;
};

export type RecordStockChangeResult =
  | { ok: true; previousQty: number; newQty: number; sellerId: string; productId: string }
  | { ok: false; error: string };

type ResolvedTarget = {
  productId: string;
  sellerId: string | null;
  audience: VariantAudience;
  minStockQty: number;
  reorderLevel: number;
};

async function resolveTarget(tx: TxClient, target: StockTarget): Promise<ResolvedTarget | null> {
  if (target.kind === "variant") {
    const variant = await tx.productVariant.findUnique({
      where: { id: target.variantId },
      select: {
        audience: true,
        minStockQty: true,
        reorderLevel: true,
        product: { select: { id: true, sellerId: true } },
      },
    });
    if (!variant) return null;
    return {
      productId: variant.product.id,
      sellerId: variant.product.sellerId,
      audience: variant.audience,
      minStockQty: variant.minStockQty,
      reorderLevel: variant.reorderLevel,
    };
  }
  const product = await tx.product.findUnique({
    where: { id: target.productId },
    select: { id: true, sellerId: true },
  });
  if (!product) return null;
  if (target.audience === "CUSTOMER") {
    const config = await tx.productCustomerConfig.findUnique({
      where: { productId: target.productId },
      select: { minStockQty: true, reorderLevel: true },
    });
    if (!config) return null;
    return {
      productId: product.id,
      sellerId: product.sellerId,
      audience: "CUSTOMER",
      minStockQty: config.minStockQty,
      reorderLevel: config.reorderLevel,
    };
  }
  const config = await tx.productDealerConfig.findUnique({
    where: { productId: target.productId },
    select: { minStockQty: true, reorderLevel: true },
  });
  if (!config) return null;
  return {
    productId: product.id,
    sellerId: product.sellerId,
    audience: "DEALER",
    minStockQty: config.minStockQty,
    reorderLevel: config.reorderLevel,
  };
}

/** Applies the write with the DB doing the concurrency-safety guard — same conditional-updateMany pattern already established in packages/orders/src/stock.ts, extended to also support an absolute "set" (optimistic-concurrency, guarded by the exact previous value the caller read) for manual corrections. */
async function applyWrite(
  tx: TxClient,
  target: StockTarget,
  change: StockChangeSpec,
): Promise<{ ok: true; newQty: number } | { ok: false; error: string }> {
  if (target.kind === "variant") {
    const where =
      change.mode === "delta"
        ? { id: target.variantId, stockQty: { gte: -change.delta } }
        : { id: target.variantId, stockQty: change.expectedPreviousQty };
    const data =
      change.mode === "delta"
        ? { stockQty: { increment: change.delta } }
        : { stockQty: change.newQty };
    const result = await tx.productVariant.updateMany({ where, data });
    if (result.count !== 1) {
      return {
        ok: false,
        error:
          change.mode === "delta"
            ? "Insufficient stock for this change."
            : "Stock was changed by someone else since you loaded this page — refresh and try again.",
      };
    }
    const row = await tx.productVariant.findUniqueOrThrow({
      where: { id: target.variantId },
      select: { stockQty: true },
    });
    return { ok: true, newQty: row.stockQty };
  }

  const client = target.audience === "CUSTOMER" ? tx.productCustomerConfig : tx.productDealerConfig;
  const where =
    change.mode === "delta"
      ? { productId: target.productId, currentStock: { gte: -change.delta } }
      : { productId: target.productId, currentStock: change.expectedPreviousQty };
  const data =
    change.mode === "delta"
      ? { currentStock: { increment: change.delta } }
      : { currentStock: change.newQty };
  const result = await (client as typeof tx.productCustomerConfig).updateMany({ where, data });
  if (result.count !== 1) {
    return {
      ok: false,
      error:
        change.mode === "delta"
          ? "Insufficient stock for this change."
          : "Stock was changed by someone else since you loaded this page — refresh and try again.",
    };
  }
  const row = await (client as typeof tx.productCustomerConfig).findUniqueOrThrow({
    where: { productId: target.productId },
    select: { currentStock: true },
  });
  return { ok: true, newQty: row.currentStock };
}

export async function recordStockChange(
  tx: TxClient,
  params: RecordStockChangeParams,
): Promise<RecordStockChangeResult> {
  const resolved = await resolveTarget(tx, params.target);
  if (!resolved) return { ok: false, error: "Inventory record not found." };
  if (!resolved.sellerId) {
    return { ok: false, error: "This product has no owning seller and is not stock-managed here." };
  }
  if (params.expectedSellerId && resolved.sellerId !== params.expectedSellerId) {
    return { ok: false, error: "You do not have permission to adjust this inventory." };
  }
  if (params.change.mode === "delta" && !Number.isInteger(params.change.delta)) {
    return { ok: false, error: "Quantity must be a whole number." };
  }
  if (
    params.change.mode === "set" &&
    (!Number.isInteger(params.change.newQty) || params.change.newQty < 0)
  ) {
    return { ok: false, error: "Quantity must be a whole number that is zero or greater." };
  }

  const write = await applyWrite(tx, params.target, params.change);
  if (!write.ok) return { ok: false, error: write.error };

  const newQty = write.newQty;
  const previousQty =
    params.change.mode === "delta"
      ? newQty - params.change.delta
      : params.change.expectedPreviousQty;
  const changeQty = newQty - previousQty;

  await tx.stockAdjustment.create({
    data: {
      sellerId: resolved.sellerId,
      productId: resolved.productId,
      variantId: params.target.kind === "variant" ? params.target.variantId : null,
      audience: resolved.audience,
      previousQty,
      changeQty,
      newQty,
      adjustmentType: params.adjustmentType,
      sourceType: params.sourceType,
      reason: params.reason?.trim() || null,
      relatedOrderId: params.relatedOrderId ?? null,
      performedByUserId: params.performedBy.id,
      performedByRole: params.performedBy.role,
    },
  });

  if (previousQty <= 0 && newQty > 0) {
    const { triggerRestockNotifications } = await import("./restock-subscriptions");
    await triggerRestockNotifications(tx, {
      productId: resolved.productId,
      variantId: params.target.kind === "variant" ? params.target.variantId : null,
      audience: resolved.audience,
    });
  }

  return {
    ok: true,
    previousQty,
    newQty,
    sellerId: resolved.sellerId,
    productId: resolved.productId,
  };
}

// ---------------------------------------------------------------------------
// Ledger history — "View History" modal.
// ---------------------------------------------------------------------------

export type StockAdjustmentRow = {
  id: string;
  previousQty: number;
  changeQty: number;
  newQty: number;
  adjustmentType: StockAdjustmentType;
  sourceType: StockAdjustmentSource;
  reason: string | null;
  relatedOrderId: string | null;
  performedByUserId: string;
  performedByRole: UserRole;
  performedByName: string | null;
  createdAt: Date;
};

export async function listStockAdjustments(
  target: StockTarget,
  opts: { expectedSellerId?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: StockAdjustmentRow[]; total: number } | { ok: false; error: string }> {
  const resolved = await resolveTarget(prisma, target);
  if (!resolved) return { ok: false, error: "Inventory record not found." };
  if (opts.expectedSellerId && resolved.sellerId !== opts.expectedSellerId) {
    return { ok: false, error: "You do not have permission to view this history." };
  }
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 20;

  const where: Prisma.StockAdjustmentWhereInput = {
    productId: resolved.productId,
    audience: resolved.audience,
    variantId: target.kind === "variant" ? target.variantId : null,
  };

  const [rows, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockAdjustment.count({ where }),
  ]);

  const performerIds = [...new Set(rows.map((r) => r.performedByUserId))];
  const performers =
    performerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: performerIds } },
          select: { id: true, firstName: true, lastName: true, phone: true },
        })
      : [];
  const nameById = new Map(performers.map((p) => [p.id, getFullName(p) ?? p.phone ?? "—"]));

  return {
    rows: rows.map((r) => ({ ...r, performedByName: nameById.get(r.performedByUserId) ?? null })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Live availability for the catalogue layer (spec §8) — a much smaller,
// live-only counterpart to the ledger/table logic above: given a
// product+variant reference, is it purchasable right now?
// ---------------------------------------------------------------------------

export async function getVariantAvailableQty(variantId: string): Promise<number | null> {
  const v = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { stockQty: true },
  });
  return v?.stockQty ?? null;
}

// ---------------------------------------------------------------------------
// Thresholds — spec §3's minimum-quantity/reorder-level pair. Deliberately
// NOT routed through recordStockChange/StockAdjustment: these gate the
// stock-STATUS calculation, they aren't a quantity movement, so spec §6's
// "every stock change creates a ledger record" doesn't apply to them (the
// product form edits them the same way, unguarded by a ledger, for the
// exact same reason).
// ---------------------------------------------------------------------------

export type UpdateThresholdsResult = { ok: true } | { ok: false; error: string };

export async function updateStockThresholds(
  target: StockTarget,
  thresholds: { minStockQty: number; reorderLevel: number },
  expectedSellerId?: string,
): Promise<UpdateThresholdsResult> {
  if (!Number.isInteger(thresholds.minStockQty) || thresholds.minStockQty < 0) {
    return { ok: false, error: "Minimum quantity must be a whole number that is zero or greater." };
  }
  if (!Number.isInteger(thresholds.reorderLevel) || thresholds.reorderLevel < 0) {
    return { ok: false, error: "Reorder level must be a whole number that is zero or greater." };
  }
  if (thresholds.reorderLevel <= thresholds.minStockQty) {
    return { ok: false, error: "Reorder level must be greater than minimum quantity." };
  }

  const resolved = await resolveTarget(prisma, target);
  if (!resolved) return { ok: false, error: "Inventory record not found." };
  if (expectedSellerId && resolved.sellerId !== expectedSellerId) {
    return { ok: false, error: "You do not have permission to edit this inventory." };
  }

  if (target.kind === "variant") {
    await prisma.productVariant.update({
      where: { id: target.variantId },
      data: { minStockQty: thresholds.minStockQty, reorderLevel: thresholds.reorderLevel },
    });
  } else if (target.audience === "CUSTOMER") {
    await prisma.productCustomerConfig.update({
      where: { productId: target.productId },
      data: { minStockQty: thresholds.minStockQty, reorderLevel: thresholds.reorderLevel },
    });
  } else {
    await prisma.productDealerConfig.update({
      where: { productId: target.productId },
      data: { minStockQty: thresholds.minStockQty, reorderLevel: thresholds.reorderLevel },
    });
  }

  return { ok: true };
}

export { targetKey as inventoryTargetKey };
