"use client";

import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  Thumbnail,
  formatDate,
  formatNumber,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";

export type SellerRequestRow = {
  id: string;
  publicRequestNumber: string;
  createdAt: Date | string;
  product: { name: string; primaryImageUrl: string };
  quantity: number;
  status: string;
};

const FILTER_KEYS = ["status", "dateFrom", "dateTo"];

// Never PENDING/REJECTED here — a seller can't be shown a request the
// admin hasn't approved (see SELLER_VISIBLE_STATUSES in
// packages/catalog/src/product-requests.ts).
const STATUS_OPTIONS = [
  { value: "APPROVED", label: "Approved" },
  { value: "VIEWED", label: "Viewed" },
  { value: "RESPONDED", label: "Responded" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function SellerRequestsTable({
  requests,
  total,
  page,
  pageSize,
}: {
  requests: SellerRequestRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<SellerRequestRow>[] = [
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
          <Thumbnail src={r.product.primaryImageUrl} alt="" />
          <span className="truncate font-semibold text-ink">{r.product.name}</span>
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      sortable: true,
      align: "right",
      value: (r) => r.quantity,
      render: (r) => <span className="text-ink">{formatNumber(r.quantity)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "createdAt",
      header: "Received",
      sortable: true,
      value: (r) => r.createdAt,
      render: (r) => <span className="text-gray-600">{formatDate(r.createdAt)}</span>,
      hideBelow: "lg",
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={requests}
      columns={columns}
      rowKey={(r) => r.id}
      renderActions={(r) => (
        <Link
          href={`/seller/requests/${r.id}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold text-green-700 transition-colors hover:bg-green-50"
        >
          View
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
      caption="Dealer requests"
      searchPlaceholder="Search by product name…"
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
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Received" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<Inbox className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No requests yet"
      emptyDescription="Enquiries from dealers about your products will show up here."
    />
  );
}
