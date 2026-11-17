"use client";

import Link from "next/link";
import { ShieldAlert, Users } from "lucide-react";
import {
  ActiveBadge,
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  IdentityCell,
  StatusBadge,
  TableFilterSelect,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { BaRowActions } from "./ba-row-actions";
import {
  DeletionStatusBadge,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

export type BaRow = {
  id: string;
  userId: string;
  referralCode: string;
  userName: string;
  contactNumber: string;
  status: "PENDING" | "APPROVED" | "BANK_SUBMITTED" | "REJECTED" | "SUSPENDED";
  userIsActive: boolean;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  deletionStatus: ActiveDeletionStatus | null;
  referredCount: number;
  referredOrders: number;
  referredSales: number;
  totalCommission: number;
  redeemableCommission: number;
  hasBankDetails: boolean;
  panNumber: string | null;
};

const FILTER_KEYS = ["status", "active"];

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved (no bank)" },
  { value: "BANK_SUBMITTED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SUSPENDED", label: "Suspended" },
];

export function BaTable({
  bas,
  total,
  page,
  pageSize,
}: {
  bas: BaRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<BaRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      value: (b) => b.userName,
      render: (b) => (
        <Link href={`/admin/business-associates/${b.id}`} className="hover:underline">
          <IdentityCell name={b.userName} subtitle={b.contactNumber} />
        </Link>
      ),
    },
    {
      key: "code",
      header: "Referral code",
      value: (b) => b.referralCode,
      render: (b) => <span className="font-mono text-xs text-gray-600">{b.referralCode}</span>,
    },
    {
      key: "status",
      header: "Status",
      value: (b) => b.status,
      render: (b) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={b.status} />
          {!b.userIsActive && <ActiveBadge active={false} />}
          <DeletionStatusBadge
            requestedAt={b.deletionRequestedAt}
            scheduledFor={b.deletionScheduledFor}
          />
        </div>
      ),
    },
    {
      key: "referrals",
      header: "Referred",
      value: (b) => b.referredCount,
      render: (b) => (
        <div className="text-sm">
          <div className="text-ink">{b.referredCount} customers</div>
          <div className="text-xs text-gray-500">
            {b.referredOrders} orders · ₹
            {b.referredSales.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>
      ),
      mobileHidden: true,
    },
    {
      key: "commission",
      header: "Commission",
      value: (b) => b.totalCommission,
      render: (b) => (
        <div className="text-sm">
          <div className="text-ink">
            ₹{b.totalCommission.toLocaleString("en-IN", { maximumFractionDigits: 0 })} total
          </div>
          <div className="text-xs text-green-700">
            ₹{b.redeemableCommission.toLocaleString("en-IN", { maximumFractionDigits: 0 })}{" "}
            redeemable
          </div>
        </div>
      ),
    },
    {
      key: "payoutReady",
      header: "Payout readiness",
      render: (b) =>
        b.hasBankDetails && b.panNumber ? (
          <span className="text-xs font-semibold text-green-700">Ready</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Missing{" "}
            {!b.panNumber && !b.hasBankDetails
              ? "bank + PAN"
              : !b.panNumber
                ? "PAN"
                : "bank details"}
          </span>
        ),
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={bas}
      columns={columns}
      rowKey={(b) => b.id}
      renderActions={(b) => (
        <BaRowActions
          baId={b.id}
          userId={b.userId}
          userName={b.userName}
          isActive={b.userIsActive}
          status={b.status}
          deletionStatus={b.deletionStatus}
        />
      )}
      caption="Business Associates"
      searchPlaceholder="Search by name, code, phone, or email…"
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
            paramKey="active"
            label="Any account status"
            options={[
              { value: "yes", label: "Active account" },
              { value: "no", label: "Inactive account" },
            ]}
          />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<Users className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No Business Associates yet"
    />
  );
}
