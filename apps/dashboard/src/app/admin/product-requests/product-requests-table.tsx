"use client";

import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  IdentityCell,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  Thumbnail,
  formatNumber,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";

export type ProductRequestRow = {
  id: string;
  publicRequestNumber: string;
  product: { name: string; primaryImageUrl: string };
  dealer: { storeName: string | null };
  seller: { shopName: string };
  quantity: number;
  deliveryState: { name: string };
  status: string;
};

const FILTER_KEYS = ["status", "state", "dateFrom", "dateTo"];

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "VIEWED", label: "Viewed by seller" },
  { value: "RESPONDED", label: "Responded" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function ProductRequestsTable({
  requests,
  states,
  total,
  page,
  pageSize,
}: {
  requests: ProductRequestRow[];
  states: { id: string; name: string }[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<ProductRequestRow>[] = [
    {
      key: "requestNumber",
      header: "Request #",
      value: (r) => r.publicRequestNumber,
      render: (r) => (
        <span className="font-mono text-xs text-gray-600">{r.publicRequestNumber}</span>
      ),
      hideBelow: "md",
      mobileHidden: true,
    },
    {
      key: "product",
      header: "Product",
      primary: true,
      value: (r) => r.product.name,
      render: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail src={r.product.primaryImageUrl} alt="" size="sm" />
          <span className="truncate font-semibold text-ink">{r.product.name}</span>
        </div>
      ),
    },
    {
      key: "dealer",
      header: "Dealer",
      value: (r) => r.dealer.storeName ?? "",
      render: (r) => <IdentityCell name={r.dealer.storeName ?? "—"} />,
    },
    {
      key: "seller",
      header: "Seller",
      value: (r) => r.seller.shopName,
      render: (r) => <span className="text-gray-600">{r.seller.shopName}</span>,
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      sortable: true,
      value: (r) => r.quantity,
      render: (r) => <span className="tabular-nums text-ink">{formatNumber(r.quantity)}</span>,
    },
    {
      key: "state",
      header: "State",
      value: (r) => r.deliveryState.name,
      render: (r) => <span className="text-gray-600">{r.deliveryState.name}</span>,
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <AdminDataTable
      data={requests}
      columns={columns}
      rowKey={(r) => r.id}
      renderActions={(r) => (
        <Link
          href={`/admin/product-requests/${r.id}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold text-green-700 transition-colors hover:bg-green-50"
        >
          Review
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
      caption="Dealer product requests"
      searchPlaceholder="Search by product, dealer, or seller…"
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
            paramKey="state"
            label="Any state"
            options={states.map((s) => ({ value: s.id, label: s.name }))}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Date" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<ClipboardList className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No requests yet"
    />
  );
}
