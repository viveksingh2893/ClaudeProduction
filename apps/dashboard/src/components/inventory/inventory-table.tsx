"use client";

import { useState } from "react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  Badge,
  Button,
  FilterDrawer,
  ProductImage,
  RowActionMenu,
  TableFilterSelect,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import { History, ListChecks, Package, PlusCircle, SlidersHorizontal, SquarePen } from "lucide-react";
import { AddQuantityModal } from "./add-quantity-modal";
import { SetQuantityModal } from "./set-quantity-modal";
import { EditThresholdsModal } from "./edit-thresholds-modal";
import { HistoryModal } from "./history-modal";
import { BulkUpdateModal } from "./bulk-update-modal";
import type { InventoryActions, InventoryRowDTO } from "./types";

const FILTER_KEYS = [
  "sellerId",
  "categoryId",
  "subCategoryId",
  "subSubCategoryId",
  "brandId",
  "audience",
  "stockStatus",
  "productStatus",
];

const STOCK_STATUS_OPTIONS = [
  { value: "IN_STOCK", label: "In stock" },
  { value: "REORDER_REQUIRED", label: "Reorder required" },
  { value: "MINIMUM_LEVEL", label: "Minimum level" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
];

const PRODUCT_STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "INACTIVE", label: "Inactive" },
];

export function InventoryTable({
  role,
  rows,
  total,
  page,
  pageSize,
  actions,
  sellers,
  categories,
  subCategories,
  subSubCategories,
  brands,
}: {
  role: "SELLER" | "ADMIN";
  rows: InventoryRowDTO[];
  total: number;
  page: number;
  pageSize: number;
  actions: InventoryActions;
  sellers?: { id: string; shopName: string }[];
  categories: { id: string; name: string }[];
  subCategories: { id: string; name: string }[];
  subSubCategories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(
    role === "ADMIN" ? FILTER_KEYS : FILTER_KEYS.slice(1),
  );
  const clearAllFilters = useClearUrlFilters(role === "ADMIN" ? FILTER_KEYS : FILTER_KEYS.slice(1));

  const [addRow, setAddRow] = useState<InventoryRowDTO | null>(null);
  const [setRow, setSetRow] = useState<InventoryRowDTO | null>(null);
  const [thresholdRow, setThresholdRow] = useState<InventoryRowDTO | null>(null);
  const [historyRow, setHistoryRow] = useState<InventoryRowDTO | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const columns: DataTableColumn<InventoryRowDTO>[] = [
    {
      key: "product",
      header: "Product / Variant",
      primary: true,
      sortable: true,
      value: (r) => r.productName,
      render: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-green-50">
            <ProductImage src={r.imageUrl} alt={r.productName} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">{r.productName}</div>
            <div className="truncate text-xs text-gray-500">{r.variantLabel}</div>
          </div>
        </div>
      ),
    },
    {
      key: "sku",
      header: "SKU / Audience",
      value: (r) => r.sku,
      render: (r) => (
        <div className="text-sm">
          <div className="font-mono text-xs text-gray-600">{r.sku}</div>
          <Badge tone={r.audience === "DEALER" ? "warning" : "info"}>
            {r.audience === "DEALER" ? "Dealer" : "Customer"}
          </Badge>
        </div>
      ),
    },
    ...(role === "ADMIN"
      ? [
          {
            key: "seller",
            header: "Seller",
            sortable: true,
            value: (r: InventoryRowDTO) => r.sellerName,
            render: (r: InventoryRowDTO) => <span className="text-gray-600">{r.sellerName}</span>,
            mobileHidden: true,
          } as DataTableColumn<InventoryRowDTO>,
        ]
      : []),
    {
      key: "stockLevels",
      header: "Stock Levels",
      align: "right",
      sortable: true,
      value: (r) => r.onHandQty,
      render: (r) => (
        <div className="flex justify-end gap-3 text-xs">
          <div className="text-right">
            <div className="text-[10px] uppercase text-gray-400">On hand</div>
            <div className="font-semibold text-ink">{r.onHandQty}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-gray-400">Reorder</div>
            <div className="text-gray-600">{r.reorderLevel}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-gray-400">Minimum</div>
            <div className="text-gray-600">{r.minStockQty}</div>
          </div>
        </div>
      ),
    },
    {
      key: "stockStatus",
      header: "Status",
      sortable: true,
      value: (r) => r.stockStatus.status,
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={r.stockStatus.tone}>{r.stockStatus.label}</Badge>
          {r.stockStatus.status === "OUT_OF_STOCK" && r.waitingCount > 0 && (
            <span className="text-xs font-semibold text-danger">{r.waitingCount} waiting</span>
          )}
        </div>
      ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      sortable: true,
      value: (r) => r.updatedAt,
      render: (r) => <span className="text-gray-500">{formatDate(r.updatedAt, true)}</span>,
      mobileHidden: true,
    },
  ];

  function rowClassName(r: InventoryRowDTO): string {
    if (r.stockStatus.status === "OUT_OF_STOCK" || r.stockStatus.status === "MINIMUM_LEVEL") {
      return "bg-danger-bg/40";
    }
    if (r.stockStatus.status === "REORDER_REQUIRED") return "bg-warning-bg/40";
    return "";
  }

  function actionsFor(r: InventoryRowDTO): RowAction[] {
    return [
      {
        label: "Adjust stock",
        icon: <PlusCircle className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setAddRow(r),
      },
      {
        label: "Set / correct quantity",
        icon: <SquarePen className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setSetRow(r),
      },
      {
        label: "Edit thresholds",
        icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setThresholdRow(r),
      },
      {
        label: "View history",
        icon: <History className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setHistoryRow(r),
      },
    ];
  }

  return (
    <>
      <AdminDataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.key}
        rowClassName={rowClassName}
        renderActions={(r) => <RowActionMenu actions={actionsFor(r)} maxInline={1} />}
        toolbarActions={
          actions.bulkPreview && actions.bulkApply ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
              Bulk Update
            </Button>
          ) : undefined
        }
        caption="Product quantity"
        searchPlaceholder={
          role === "ADMIN"
            ? "Product, variant, attribute, SKU, or seller…"
            : "Product, variant, attribute, or SKU…"
        }
        server={{
          totalItems: total,
          page,
          pageSize,
          onPageChange: table.setPage,
          onPageSizeChange: table.setPageSize,
          searchValue: table.searchInput,
          onSearchChange: table.setSearchInput,
          onSearchSubmit: table.submitSearch,
          sortKey: table.sortKey,
          sortDir: table.sortDir,
          onSortChange: table.setSort,
        }}
        hasActiveFilters={activeFilterCount > 0}
        filters={
          <FilterDrawer count={activeFilterCount}>
            {role === "ADMIN" && sellers && (
              <TableFilterSelect
                paramKey="sellerId"
                label="Any seller"
                options={sellers.map((s) => ({ value: s.id, label: s.shopName }))}
              />
            )}
            <TableFilterSelect
              paramKey="categoryId"
              label="Any category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <TableFilterSelect
              paramKey="subCategoryId"
              label="Any subcategory"
              options={subCategories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <TableFilterSelect
              paramKey="subSubCategoryId"
              label="Any sub-subcategory"
              options={subSubCategories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <TableFilterSelect
              paramKey="brandId"
              label="Any brand"
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
            />
            <TableFilterSelect
              paramKey="audience"
              label="Customer or Dealer"
              options={[
                { value: "CUSTOMER", label: "Customer" },
                { value: "DEALER", label: "Dealer" },
              ]}
            />
            <TableFilterSelect
              paramKey="stockStatus"
              label="Any stock status"
              options={STOCK_STATUS_OPTIONS}
            />
            <TableFilterSelect
              paramKey="productStatus"
              label="Any product status"
              options={PRODUCT_STATUS_OPTIONS}
            />
          </FilterDrawer>
        }
        clearFiltersAction={
          <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
        }
        emptyIcon={<Package className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No inventory yet"
        emptyDescription={
          role === "ADMIN"
            ? "Inventory rows appear here once sellers have products with variants or stock configured."
            : "Inventory rows appear here once your products have variants or stock configured."
        }
      />

      {addRow && (
        <AddQuantityModal row={addRow} actions={actions} onClose={() => setAddRow(null)} />
      )}
      {setRow && (
        <SetQuantityModal row={setRow} actions={actions} onClose={() => setSetRow(null)} />
      )}
      {thresholdRow && (
        <EditThresholdsModal
          row={thresholdRow}
          actions={actions}
          onClose={() => setThresholdRow(null)}
        />
      )}
      {historyRow && (
        <HistoryModal
          row={historyRow}
          actions={actions}
          showPerformer={role === "ADMIN"}
          onClose={() => setHistoryRow(null)}
        />
      )}
      {bulkOpen && actions.bulkPreview && actions.bulkApply && (
        <BulkUpdateModal
          actions={{ bulkPreview: actions.bulkPreview, bulkApply: actions.bulkApply }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  );
}
