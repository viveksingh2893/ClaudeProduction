"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import {
  ActiveBadge,
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  IdentityCell,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  Truncate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { SellerRowActions } from "./seller-row-actions";
import {
  DeletionStatusBadge,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

export type SellerRow = {
  id: string;
  user: {
    id: string;
    name: string;
    email: string | null;
    isActive: boolean;
    deletionRequestedAt: Date | null;
    deletionScheduledFor: Date | null;
    deletionStatus: ActiveDeletionStatus | null;
  };
  shopName: string;
  gstNumber: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
  orderCount: number;
  salesValue: number;
};

const FILTER_KEYS = ["status", "active", "dateFrom", "dateTo"];

export function SellersTable({
  sellers,
  total,
  page,
  pageSize,
}: {
  sellers: SellerRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<SellerRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (s) => s.user.name,
      render: (s) => (
        <Link href={`/admin/sellers/${s.id}`} className="hover:underline">
          <IdentityCell name={s.user.name} subtitle={s.user.email ?? undefined} />
        </Link>
      ),
    },
    {
      key: "business",
      header: "Business",
      value: (s) => s.shopName,
      render: (s) => (
        <div className="text-sm">
          <div className="font-semibold text-ink">{s.shopName}</div>
          {s.gstNumber ? (
            <Truncate
              value={s.gstNumber}
              className="font-mono text-xs text-gray-500"
              maxWidth="160px"
            />
          ) : (
            <span className="text-xs text-gray-400">No GST on file</span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (s) => s.status,
      render: (s) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={s.status} />
          {!s.user.isActive && <ActiveBadge active={false} />}
          <DeletionStatusBadge
            requestedAt={s.user.deletionRequestedAt}
            scheduledFor={s.user.deletionScheduledFor}
          />
        </div>
      ),
    },
    {
      key: "ordersSales",
      header: "Orders / Sales",
      value: (s) => s.salesValue,
      render: (s) => (
        <div className="text-sm">
          <div className="text-ink">{s.orderCount} orders</div>
          <div className="text-xs text-gray-500">
            ₹{s.salesValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>
      ),
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={sellers}
      columns={columns}
      rowKey={(s) => s.id}
      renderActions={(s) => (
        <SellerRowActions
          profileId={s.id}
          userId={s.user.id}
          userName={s.user.name}
          isActive={s.user.isActive}
          status={s.status}
          deletionStatus={s.user.deletionStatus}
        />
      )}
      caption="Seller applications"
      searchPlaceholder="Search by name, email, shop, or GST…"
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
          <TableFilterSelect
            paramKey="status"
            label="Any status"
            options={[
              { value: "PENDING", label: "Pending" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
              { value: "SUSPENDED", label: "Suspended" },
            ]}
          />
          <TableFilterSelect
            paramKey="active"
            label="Any account status"
            options={[
              { value: "yes", label: "Active account" },
              { value: "no", label: "Inactive account" },
            ]}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Registered" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<ShoppingBag className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No seller applications yet"
    />
  );
}
