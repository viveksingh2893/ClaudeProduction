import { AlertTriangle, CheckCircle2, Package, XCircle } from "lucide-react";
import { prisma } from "@kisan4u/db";
import {
  countStockAdjustmentsToday,
  getInventoryStatusSummary,
  listInventory,
  type InventorySortKey,
} from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireInventoryAccess } from "@/lib/inventory-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { InventoryTable } from "@/components/inventory/inventory-table";
import type { InventoryRowDTO } from "@/components/inventory/types";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import {
  adminAddStockAction,
  adminSetStockAction,
  adminEditThresholdsAction,
  adminListStockHistoryAction,
  adminPreviewBulkStockAction,
  adminApplyBulkStockAction,
} from "./actions";

const SORT_KEYS: InventorySortKey[] = [
  "productName",
  "variantName",
  "availableQty",
  "minStockQty",
  "reorderLevel",
  "stockStatus",
  "updatedAt",
  "seller",
];
const STOCK_STATUSES = ["IN_STOCK", "REORDER_REQUIRED", "MINIMUM_LEVEL", "OUT_OF_STOCK"];

export default async function AdminProductQuantityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireInventoryAccess();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const sortKey = SORT_KEYS.includes(sp.sort as InventorySortKey)
    ? (sp.sort as InventorySortKey)
    : undefined;
  const tab = STOCK_STATUSES.includes(sp.tab ?? "") ? sp.tab! : "all";

  const inventoryFilters = {
    sellerId: sp.sellerId || undefined,
    categoryId: sp.categoryId || undefined,
    subCategoryId: sp.subCategoryId || undefined,
    subSubCategoryId: sp.subSubCategoryId || undefined,
    brandId: sp.brandId || undefined,
    audience: (sp.audience === "CUSTOMER" || sp.audience === "DEALER" ? sp.audience : undefined) as
      | "CUSTOMER"
      | "DEALER"
      | undefined,
    productStatus: sp.productStatus || undefined,
    search: sp.q || undefined,
  };

  const [{ rows, total }, sellers, categories, subCategories, subSubCategories, brands, summary, adjustmentsToday] =
    await Promise.all([
      listInventory(
        {
          ...inventoryFilters,
          stockStatus: STOCK_STATUSES.includes(tab)
            ? (tab as "IN_STOCK" | "REORDER_REQUIRED" | "MINIMUM_LEVEL" | "OUT_OF_STOCK")
            : undefined,
          sortKey,
          sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
          page,
          pageSize,
        },
        {},
      ),
      prisma.sellerProfile.findMany({
        where: { status: "APPROVED" },
        select: { id: true, shopName: true },
        orderBy: { shopName: "asc" },
      }),
      prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.subcategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.subSubCategory.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.brand.findMany({
        where: { status: "APPROVED" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      getInventoryStatusSummary(inventoryFilters, {}),
      countStockAdjustmentsToday(),
    ]);

  const dtoRows: InventoryRowDTO[] = rows.map((r) => ({
    key: r.key,
    productId: r.productId,
    productName: r.productName,
    productSlug: r.productSlug,
    imageUrl: resolveStorefrontAssetUrl(r.imageUrl) ?? "",
    variantId: r.variantId,
    variantLabel: r.variantLabel,
    sku: r.sku,
    hsnCode: r.hsnCode,
    sellerId: r.sellerId,
    sellerName: r.sellerName,
    audience: r.audience,
    onHandQty: r.onHandQty,
    availableQty: r.availableQty,
    minStockQty: r.minStockQty,
    reorderLevel: r.reorderLevel,
    stockStatus: r.stockStatus,
    updatedAt: r.updatedAt.toISOString(),
    productStatus: r.productStatus,
    waitingCount: r.waitingCount ?? 0,
  }));

  function tabHref(tabKey: string) {
    const params = new URLSearchParams();
    if (tabKey !== "all") params.set("tab", tabKey);
    return params.toString() ? `/admin/product-quantity?${params.toString()}` : "/admin/product-quantity";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.trackedVariants, href: tabHref("all") },
    { key: "IN_STOCK", label: "Healthy", count: summary.healthy, href: tabHref("IN_STOCK") },
    { key: "REORDER_REQUIRED", label: "Reorder", count: summary.reorder, href: tabHref("REORDER_REQUIRED") },
    { key: "MINIMUM_LEVEL", label: "Minimum", count: summary.minimum, href: tabHref("MINIMUM_LEVEL") },
    { key: "OUT_OF_STOCK", label: "Out of Stock", count: summary.outOfStock, href: tabHref("OUT_OF_STOCK") },
  ];
  const attentionCount = summary.reorder + summary.minimum + summary.outOfStock;

  return (
    <PageContainer className="py-8" maxWidth="1400px">
      <PageHeader
        title="Inventory Management"
        description="Monitor and update stock separately for customer and dealer variants."
      />

      <StatCardsRow>
        <StatCard icon={<Package className="h-5 w-5" aria-hidden="true" />} label="Tracked variants" value={summary.trackedVariants} hint="Customer and dealer records" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />} label="Healthy stock" value={summary.healthy} tone="green" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />} label="At reorder level" value={summary.reorder} hint="Restock soon" tone={summary.reorder > 0 ? "amber" : "neutral"} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />} label="At minimum level" value={summary.minimum} hint="Critical stock" tone={summary.minimum > 0 ? "red" : "neutral"} />
        <StatCard icon={<XCircle className="h-5 w-5" aria-hidden="true" />} label="Out of stock" value={summary.outOfStock} hint="Unavailable variants" tone={summary.outOfStock > 0 ? "red" : "neutral"} />
      </StatCardsRow>

      <AlertBannerStack>
        {attentionCount > 0 && (
          <AlertBanner
            tone="red"
            title={`${attentionCount} variants need stock attention`}
            description="Variants are at reorder level, minimum level, or out of stock."
            href={tabHref("REORDER_REQUIRED")}
            linkLabel="Review priority stock"
          />
        )}
        {summary.waitingSubscribers > 0 && (
          <AlertBanner
            tone="blue"
            title={`${summary.waitingSubscribers} customers and dealers are waiting for stock-up notifications`}
            description={`Across ${summary.waitingVariantCount} variant${summary.waitingVariantCount === 1 ? "" : "s"}.`}
          />
        )}
        {adjustmentsToday > 0 && (
          <AlertBanner
            tone="blue"
            title={`${adjustmentsToday} stock adjustment${adjustmentsToday === 1 ? "" : "s"} made today`}
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />

      <InventoryTable
        role="ADMIN"
        rows={dtoRows}
        total={total}
        page={page}
        pageSize={pageSize}
        sellers={sellers}
        categories={categories}
        subCategories={subCategories}
        subSubCategories={subSubCategories}
        brands={brands}
        actions={{
          addStock: adminAddStockAction,
          setStock: adminSetStockAction,
          editThresholds: adminEditThresholdsAction,
          listHistory: adminListStockHistoryAction,
          bulkPreview: adminPreviewBulkStockAction,
          bulkApply: adminApplyBulkStockAction,
        }}
      />
    </PageContainer>
  );
}
