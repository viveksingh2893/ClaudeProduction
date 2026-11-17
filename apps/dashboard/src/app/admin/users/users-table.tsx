"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Power, Trash2, Users as UsersIcon } from "lucide-react";
import {
  ActiveBadge,
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  IdentityCell,
  RowActionMenu,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import { toggleUserActiveAction } from "../actions";
import { requestAdminAccountDeletionWithWalletConfirmation } from "../request-account-deletion";
import {
  DeletionStatusBadge,
  deletionRequestHref,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
  lastActivityAt: Date;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  deletionStatus: ActiveDeletionStatus | null;
  assignment: string;
  approvalState: string | null;
  /** The role-specific profile id (or User.id for a customer) to link "View user" to — undefined for a role with no detail page yet (ADMIN/STAFF/DELIVERY_MAN). */
  detailId?: string;
};

const FILTER_KEYS = ["role", "status", "dateFrom", "dateTo"];

const ROLE_OPTIONS = [
  { value: "CUSTOMER", label: "Customer" },
  { value: "DEALER", label: "Dealer" },
  { value: "SELLER", label: "Seller" },
  { value: "BUSINESS_ASSOCIATE", label: "Business associate" },
  { value: "ADMIN", label: "Admin" },
  { value: "DELIVERY_MAN", label: "Delivery" },
  { value: "STAFF", label: "Employee" },
];

/** Every role with its own dedicated admin detail page — everything else (ADMIN/STAFF/DELIVERY_MAN) has no per-account profile page yet, so "View user" doesn't render for those rows. */
const DETAIL_PATH_BY_ROLE: Record<string, string> = {
  DEALER: "/admin/dealers",
  SELLER: "/admin/sellers",
  CUSTOMER: "/admin/customers",
  BUSINESS_ASSOCIATE: "/admin/business-associates",
};

/** Client leaf that owns pagination/sort/search/filter URL state + the activate/deactivate mutation — the Server Component page fetches the current page via `listUsers()` and hands it down. */
export function UsersTable({
  users,
  total,
  page,
  pageSize,
}: {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function toggle(user: AdminUserRow) {
    setPendingIds((prev) => new Set(prev).add(user.id));
    startTransition(async () => {
      try {
        await toggleUserActiveAction({ userId: user.id, isActive: !user.isActive });
        router.refresh();
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      }
    });
  }

  function requestDeletion(user: AdminUserRow) {
    if (!window.confirm(`Schedule deletion for ${user.name}? Eligibility checks will run first.`))
      return;
    setPendingIds((prev) => new Set(prev).add(user.id));
    startTransition(async () => {
      try {
        const result = await requestAdminAccountDeletionWithWalletConfirmation(user.id, user.name);
        if (!result) return;
        if (!result.ok) window.alert(result.error);
        router.refresh();
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      }
    });
  }

  const columns: DataTableColumn<AdminUserRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (u) => u.name,
      render: (u) => {
        const href =
          u.detailId && DETAIL_PATH_BY_ROLE[u.role]
            ? `${DETAIL_PATH_BY_ROLE[u.role]}/${u.detailId}`
            : null;
        const identity = <IdentityCell name={u.name} subtitle={u.email ?? u.phone ?? undefined} />;
        return href ? (
          <Link href={href} className="hover:underline">
            {identity}
          </Link>
        ) : (
          identity
        );
      },
    },
    {
      key: "role",
      header: "Role / Assignment",
      sortable: true,
      value: (u) => u.role,
      render: (u) => (
        <div className="text-sm">
          <div className="font-semibold text-ink">
            {ROLE_OPTIONS.find((r) => r.value === u.role)?.label ?? u.role}
          </div>
          <div className="text-xs text-gray-500">{u.assignment}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <div className="flex flex-col items-start gap-1">
          <ActiveBadge active={u.isActive} />
          {u.approvalState && <StatusBadge status={u.approvalState} />}
          <DeletionStatusBadge
            requestedAt={u.deletionRequestedAt}
            scheduledFor={u.deletionScheduledFor}
          />
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Registered",
      sortable: true,
      value: (u) => u.createdAt,
      render: (u) => <span className="text-gray-600">{formatDate(u.createdAt)}</span>,
      mobileHidden: true,
    },
    {
      key: "lastActivityAt",
      header: "Last activity",
      value: (u) => u.lastActivityAt,
      render: (u) => <span className="text-gray-600">{formatDate(u.lastActivityAt)}</span>,
      mobileHidden: true,
    },
  ];

  function actionsFor(u: AdminUserRow): RowAction[] {
    const actions: RowAction[] = [];
    const href =
      u.detailId && DETAIL_PATH_BY_ROLE[u.role]
        ? `${DETAIL_PATH_BY_ROLE[u.role]}/${u.detailId}`
        : null;
    if (href) {
      actions.push({
        label: "View user",
        icon: <UsersIcon className="h-4 w-4" aria-hidden="true" />,
        onClick: () => router.push(href),
      });
    }
    actions.push({
      label: u.isActive ? `Deactivate ${u.name}` : `Activate ${u.name}`,
      icon: <Power className="h-4 w-4" aria-hidden="true" />,
      onClick: () => toggle(u),
      disabled: pendingIds.has(u.id),
    });
    actions.push(
      u.deletionStatus
        ? {
            label: "View deletion request",
            icon: <Eye className="h-4 w-4" aria-hidden="true" />,
            onClick: () => router.push(deletionRequestHref(u.deletionStatus!)),
          }
        : {
            label: `Delete ${u.name}'s account`,
            icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
            tone: "danger",
            onClick: () => requestDeletion(u),
            disabled: pendingIds.has(u.id),
          },
    );
    return actions;
  }

  return (
    <AdminDataTable
      data={users}
      columns={columns}
      rowKey={(u) => u.id}
      renderActions={(u) => <RowActionMenu actions={actionsFor(u)} />}
      caption="Platform users"
      searchPlaceholder="Search by name, email, or phone…"
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
          <TableFilterSelect paramKey="role" label="Any role" options={ROLE_OPTIONS} />
          <TableFilterSelect
            paramKey="status"
            label="Any status"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Registered" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<UsersIcon className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No users yet"
    />
  );
}
