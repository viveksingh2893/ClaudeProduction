"use client";

import { BadgeCheck, ShieldAlert, Store } from "lucide-react";
import Link from "next/link";
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
import { DealerRowActions } from "./dealer-row-actions";
import {
  DeletionStatusBadge,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

export type DealerRow = {
  id: string;
  user: {
    id: string;
    name: string;
    phone: string | null;
    isActive: boolean;
    deletionRequestedAt: Date | null;
    deletionScheduledFor: Date | null;
    deletionStatus: ActiveDeletionStatus | null;
  };
  storeName: string | null;
  city: string | null;
  state: string | null;
  stateId: string | null;
  gstNumber: string | null;
  licenseNumber: string | null;
  /** APPROVED but gstDocUrl or licenseDocUrl is null — see DealerProfile.hasMissingDocuments. */
  hasMissingDocuments: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
  /** Kisan4U Wallet balance, ₹ — undefined for a dealer who has never touched a wallet yet (no row provisioned). */
  walletBalance?: number;
  /** Reward points earned on delivered orders — undefined for a dealer who has never touched a wallet yet. */
  loyaltyPoints?: number;
};

const FILTER_KEYS = ["status", "state", "active", "missingDocuments"];

export function DealersTable({
  dealers,
  states,
  total,
  page,
  pageSize,
}: {
  dealers: DealerRow[];
  states: Array<{ id: string; name: string }>;
  total: number;
  page: number;
  pageSize: number;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<DealerRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (d) => d.user.name,
      render: (d) => (
        <Link href={`/admin/dealers/${d.id}`} className="hover:underline">
          <IdentityCell name={d.user.name} subtitle={d.user.phone ?? undefined} />
        </Link>
      ),
    },
    {
      key: "store",
      header: "Store",
      value: (d) => d.storeName ?? "",
      render: (d) => <span className="text-ink">{d.storeName ?? "—"}</span>,
    },
    {
      key: "location",
      header: "Location",
      value: (d) => d.city ?? "",
      render: (d) => {
        const stateName = states.find((s) => s.id === d.stateId)?.name ?? d.state;
        return (
          <div className="text-sm">
            <div className="text-ink">{d.city ?? "—"}</div>
            <div className="text-xs text-gray-500">{stateName ?? "No state set"}</div>
          </div>
        );
      },
      mobileHidden: true,
    },
    {
      key: "verification",
      header: "Verification",
      render: (d) => (
        <div className="flex flex-col gap-1 text-xs">
          <span
            className={`inline-flex items-center gap-1 ${d.gstNumber ? "text-green-700" : "text-gray-400"}`}
          >
            {d.gstNumber ? (
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            GST {d.gstNumber ? "on file" : "missing"}
          </span>
          <span
            className={`inline-flex items-center gap-1 ${d.licenseNumber ? "text-green-700" : "text-gray-400"}`}
          >
            {d.licenseNumber ? (
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Licence {d.licenseNumber ? "on file" : "missing"}
          </span>
          {d.hasMissingDocuments && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Doc missing (legacy)
            </span>
          )}
        </div>
      ),
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (d) => d.status,
      render: (d) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={d.status} />
          {!d.user.isActive && <ActiveBadge active={false} />}
          <DeletionStatusBadge
            requestedAt={d.user.deletionRequestedAt}
            scheduledFor={d.user.deletionScheduledFor}
          />
        </div>
      ),
    },
    {
      key: "walletLoyalty",
      header: "Wallet / Loyalty",
      value: (d) => d.walletBalance ?? 0,
      render: (d) => (
        <div className="text-sm">
          <div className="text-ink">₹{(d.walletBalance ?? 0).toFixed(2)}</div>
          <div className="text-xs text-gray-500">{d.loyaltyPoints ?? 0} pts</div>
        </div>
      ),
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={dealers}
      columns={columns}
      rowKey={(d) => d.id}
      renderActions={(d) => (
        <DealerRowActions
          profileId={d.id}
          userId={d.user.id}
          userName={d.user.name}
          isActive={d.user.isActive}
          status={d.status}
          stateId={d.stateId}
          states={states}
          deletionStatus={d.user.deletionStatus}
        />
      )}
      caption="Dealer applications"
      searchPlaceholder="Search by name, phone, or store…"
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
            paramKey="state"
            label="Any state"
            options={states.map((s) => ({ value: s.id, label: s.name }))}
          />
          <TableFilterSelect
            paramKey="active"
            label="Any account status"
            options={[
              { value: "yes", label: "Active account" },
              { value: "no", label: "Inactive account" },
            ]}
          />
          <TableFilterSelect
            paramKey="missingDocuments"
            label="Any documents status"
            options={[{ value: "yes", label: "Missing documents (legacy)" }]}
          />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<Store className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No dealer applications yet"
    />
  );
}
