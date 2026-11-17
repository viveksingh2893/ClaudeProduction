"use client";

import { useRouter } from "next/navigation";
import { Users as UsersIcon } from "lucide-react";
import {
  ActiveBadge,
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  IdentityCell,
  TableFilterDateRange,
  TableFilterSelect,
  formatCurrency,
  formatDate,
  formatNumber,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { UserActiveAction } from "../user-active-action";
import {
  DeletionStatusBadge,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";
import {
  ConvertToDealerButton,
  type CustomerDealerApplicationStatus,
} from "./convert-to-dealer-button";

export type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  createdAt: Date;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  deletionStatus: ActiveDeletionStatus | null;
  stateId: string | null;
  stateName: string | null;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: Date | null;
  walletBalance: number;
  dealerApplicationStatus: CustomerDealerApplicationStatus;
};

const FILTER_KEYS = ["active", "dateFrom", "dateTo", "state"];

/**
 * Same structure/quality/conventions as DealersTable (packages/ui shared
 * table primitives, useAdminTableUrlState for server-driven pagination/
 * sort/search, FilterDrawer for filters) — deliberately no dealer-only
 * columns (store, city, state, approval status): customers have no
 * DealerProfile, no minimum-order rules, and no state-availability
 * configuration to show.
 */
export function CustomersTable({
  customers,
  total,
  page,
  pageSize,
  states,
}: {
  customers: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  states: { id: string; name: string }[];
}) {
  const router = useRouter();
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<CustomerRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (c) => c.name,
      render: (c) => <IdentityCell name={c.name} subtitle={c.email ?? c.phone ?? undefined} />,
    },
    {
      key: "phone",
      header: "Phone",
      value: (c) => c.phone ?? "",
      render: (c) => <span className="text-gray-600">{c.phone ?? "—"}</span>,
      mobileHidden: true,
    },
    {
      key: "createdAt",
      header: "Registered",
      sortable: true,
      value: (c) => c.createdAt,
      render: (c) => <span className="text-gray-600">{formatDate(c.createdAt)}</span>,
      mobileHidden: true,
    },
    {
      key: "active",
      header: "Status",
      render: (c) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <ActiveBadge active={c.isActive} />
          <DeletionStatusBadge
            requestedAt={c.deletionRequestedAt}
            scheduledFor={c.deletionScheduledFor}
          />
          <span className="whitespace-nowrap text-xs text-gray-500">
            • {c.stateName ?? "State not selected"}
          </span>
        </div>
      ),
    },
    {
      key: "totalOrders",
      header: "Orders",
      align: "right",
      value: (c) => c.totalOrders,
      render: (c) => <span className="text-ink">{formatNumber(c.totalOrders)}</span>,
    },
    {
      key: "totalSpent",
      header: "Total spent",
      align: "right",
      value: (c) => c.totalSpent,
      render: (c) => <span className="text-ink">{formatCurrency(c.totalSpent)}</span>,
      mobileHidden: true,
    },
    {
      key: "lastOrderAt",
      header: "Last order",
      align: "right",
      value: (c) => c.lastOrderAt,
      render: (c) => <span className="text-gray-600">{formatDate(c.lastOrderAt)}</span>,
      mobileHidden: true,
    },
    {
      key: "wallet",
      header: "Wallet",
      align: "right",
      value: (c) => c.walletBalance,
      render: (c) => <span className="text-ink">{formatCurrency(c.walletBalance)}</span>,
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={customers}
      columns={columns}
      rowKey={(c) => c.id}
      renderActions={(c) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ConvertToDealerButton
            userId={c.id}
            customerName={c.name}
            states={states}
            applicationStatus={c.dealerApplicationStatus}
          />
          <UserActiveAction
            userId={c.id}
            userName={c.name}
            isActive={c.isActive}
            deletionStatus={c.deletionStatus}
          />
        </div>
      )}
      onRowClick={(c) => router.push(`/admin/customers/${c.id}`)}
      caption="Customers"
      searchPlaceholder="Search by name, email, phone, or state…"
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
            paramKey="active"
            label="Any account status"
            options={[
              { value: "yes", label: "Active account" },
              { value: "no", label: "Inactive account" },
            ]}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Registered" />
          <TableFilterSelect
            paramKey="state"
            label="Any state"
            options={[
              { value: "NONE", label: "State not selected" },
              ...states.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<UsersIcon className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No customers yet"
    />
  );
}
