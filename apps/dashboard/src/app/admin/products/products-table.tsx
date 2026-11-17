"use client";

import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  Badge,
  FilterDrawer,
  StatusBadge,
  TableFilterSelect,
  Thumbnail,
  formatCurrency,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { formatPriceRange } from "@/lib/product-price-range";
import { PositioningEditor, type ProductPositioning } from "./positioning-editor";

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  primaryImageUrl: string;
  category: { name: string };
  seller: { shopName: string } | null;
  lifecycleStatus: string;
  audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";
  priceMin: number | null;
  priceMax: number | null;
  variantCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  positioning: ProductPositioning;
};

function AudienceBadges({ audience }: { audience: ProductRow["audience"] }) {
  const showCustomer = audience !== "DEALER_ONLY";
  const showDealer = audience !== "CUSTOMER_ONLY";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {showCustomer && <Badge tone="info">Customer</Badge>}
      {showDealer && <Badge tone="warning">Dealer</Badge>}
    </div>
  );
}

const FILTER_KEYS = ["status", "category", "audience"];

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "INACTIVE", label: "Inactive" },
];

const AUDIENCE_OPTIONS = [
  { value: "CUSTOMER_ONLY", label: "Customer only" },
  { value: "DEALER_ONLY", label: "Dealer only" },
  { value: "BOTH_CUSTOMER_AND_DEALER", label: "Customer & dealer" },
];

export function ProductsTable({
  rows,
  total,
  page,
  pageSize,
  categories,
}: {
  rows: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: { id: string; name: string }[];
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<ProductRow>[] = [
    {
      key: "name",
      header: "Product",
      primary: true,
      sortable: true,
      value: (p) => p.name,
      render: (p) => (
        <div className="flex min-w-0 items-start gap-3">
          <Thumbnail src={p.primaryImageUrl} alt="" />
          <div className="min-w-0">
            <div
              title={p.name}
              className="font-semibold text-ink"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {p.name}
            </div>
            <div className="text-xs text-gray-500">SKU: {p.sku}</div>
          </div>
        </div>
      ),
    },
    {
      key: "classification",
      header: "Classification / Seller",
      sortable: true,
      value: (p) => p.category.name,
      render: (p) => (
        <div className="text-sm">
          <div className="text-ink">{p.category.name}</div>
          <div className="text-xs text-gray-500">{p.seller?.shopName ?? "In-house"}</div>
        </div>
      ),
    },
    {
      key: "audience",
      header: "Audience",
      render: (p) => <AudienceBadges audience={p.audience} />,
    },
    {
      key: "priceInventory",
      header: "Price / Inventory",
      align: "right",
      value: (p) => p.priceMin ?? 0,
      render: (p) => (
        <div className="text-sm">
          <div className="text-ink">
            {formatPriceRange(
              p.priceMin === null ? null : { min: p.priceMin, max: p.priceMax ?? p.priceMin },
              formatCurrency,
            )}
          </div>
          <div className="text-xs text-gray-500">
            {p.variantCount > 0 ? `${p.variantCount} variant${p.variantCount === 1 ? "" : "s"}` : "No variants"}
            {p.outOfStockCount > 0 ? (
              <span className="text-danger"> · Out of stock</span>
            ) : p.lowStockCount > 0 ? (
              <span className="text-warning"> · {p.lowStockCount} low stock</span>
            ) : p.variantCount > 0 ? (
              <span> · In stock</span>
            ) : null}
          </div>
        </div>
      ),
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (p) => p.lifecycleStatus,
      render: (p) => <StatusBadge status={p.lifecycleStatus} />,
    },
    {
      key: "positioning",
      header: "Positioning",
      render: (p) => (
        <PositioningEditor
          productId={p.id}
          productName={p.name}
          categoryName={p.category.name}
          value={p.positioning}
        />
      ),
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={rows}
      columns={columns}
      rowKey={(p) => p.id}
      renderActions={(p) => {
        const needsReview = p.lifecycleStatus === "SUBMITTED";
        return (
          <Link
            href={`/admin/products/${p.id}`}
            className={
              needsReview
                ? "inline-flex items-center gap-1 rounded-md bg-green-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-green-800"
                : "inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-gray-50"
            }
          >
            {needsReview ? "Review" : "View"}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        );
      }}
      caption="Products"
      searchPlaceholder="Search by name, SKU, or seller…"
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
          <TableFilterSelect paramKey="status" label="Any status" options={STATUS_OPTIONS} />
          <TableFilterSelect
            paramKey="category"
            label="Any category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <TableFilterSelect paramKey="audience" label="Any audience" options={AUDIENCE_OPTIONS} />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<PackageSearch className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No products match these filters"
    />
  );
}
