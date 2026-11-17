"use client";

import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  StatusBadge,
  TableFilterSelect,
  Thumbnail,
  formatCurrency,
  formatNumber,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { formatPriceRange } from "@/lib/product-price-range";

export type SellerProductRow = {
  id: string;
  name: string;
  sku: string;
  primaryImageUrl: string;
  category: { name: string };
  lifecycleStatus: string;
  priceMin: number | null;
  priceMax: number | null;
  currentStock: number | null;
};

const FILTER_KEYS = ["status", "category"];

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "INACTIVE", label: "Inactive" },
];

export function SellerProductsTable({
  rows,
  total,
  page,
  pageSize,
  categories,
}: {
  rows: SellerProductRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: { id: string; name: string }[];
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<SellerProductRow>[] = [
    {
      key: "name",
      header: "Product",
      primary: true,
      sortable: true,
      value: (p) => p.name,
      render: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail src={p.primaryImageUrl} alt="" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">{p.name}</div>
            <div className="truncate font-mono text-xs text-gray-500">{p.sku}</div>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      value: (p) => p.category.name,
      render: (p) => <span className="text-gray-600">{p.category.name}</span>,
      mobileHidden: true,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      value: (p) => p.priceMin ?? 0,
      render: (p) => (
        <span className="text-ink">
          {formatPriceRange(
            p.priceMin === null ? null : { min: p.priceMin, max: p.priceMax ?? p.priceMin },
            formatCurrency,
          )}
        </span>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      value: (p) => p.currentStock ?? 0,
      render: (p) => <span className="text-ink">{formatNumber(p.currentStock)}</span>,
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (p) => p.lifecycleStatus,
      render: (p) => <StatusBadge status={p.lifecycleStatus} />,
    },
  ];

  return (
    <AdminDataTable
      data={rows}
      columns={columns}
      rowKey={(p) => p.id}
      renderActions={(p) => (
        <Link
          href={`/seller/products/${p.id}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold text-green-700 transition-colors hover:bg-green-50"
        >
          Review
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
      caption="My products"
      searchPlaceholder="Search by name or SKU…"
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
          <TableFilterSelect paramKey="category" label="Any category" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </FilterDrawer>
      }
      clearFiltersAction={<ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />}
      emptyIcon={<PackageSearch className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No products yet"
      emptyDescription="Add your first product to start selling on Kisan4U."
    />
  );
}
