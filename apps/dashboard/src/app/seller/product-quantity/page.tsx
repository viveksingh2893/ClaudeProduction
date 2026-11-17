import { prisma } from "@kisan4u/db";
import { listInventory, type InventorySortKey } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { InventoryTable } from "@/components/inventory/inventory-table";
import type { InventoryRowDTO } from "@/components/inventory/types";
import {
  sellerAddStockAction,
  sellerSetStockAction,
  sellerEditThresholdsAction,
  sellerListStockHistoryAction,
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

export default async function SellerProductQuantityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const sortKey = SORT_KEYS.includes(sp.sort as InventorySortKey)
    ? (sp.sort as InventorySortKey)
    : undefined;

  const [{ rows, total }, categories, subCategories, subSubCategories, brands] = await Promise.all([
    listInventory(
      {
        categoryId: sp.categoryId || undefined,
        subCategoryId: sp.subCategoryId || undefined,
        subSubCategoryId: sp.subSubCategoryId || undefined,
        brandId: sp.brandId || undefined,
        audience: sp.audience === "CUSTOMER" || sp.audience === "DEALER" ? sp.audience : undefined,
        stockStatus: STOCK_STATUSES.includes(sp.stockStatus ?? "")
          ? (sp.stockStatus as "IN_STOCK" | "REORDER_REQUIRED" | "MINIMUM_LEVEL" | "OUT_OF_STOCK")
          : undefined,
        productStatus: sp.productStatus || undefined,
        search: sp.q || undefined,
        sortKey,
        sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
        page,
        pageSize,
      },
      { sellerId: sellerProfileId },
    ),
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.subSubCategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({
      where: { status: "APPROVED" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
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

  return (
    <PageContainer className="py-8" maxWidth="1300px">
      <PageHeader title="Inventory Management" />
      <InventoryTable
        role="SELLER"
        rows={dtoRows}
        total={total}
        page={page}
        pageSize={pageSize}
        categories={categories}
        subCategories={subCategories}
        subSubCategories={subSubCategories}
        brands={brands}
        actions={{
          addStock: sellerAddStockAction,
          setStock: sellerSetStockAction,
          editThresholds: sellerEditThresholdsAction,
          listHistory: sellerListStockHistoryAction,
        }}
      />
    </PageContainer>
  );
}
