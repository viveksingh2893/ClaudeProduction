"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPinned, Plus } from "lucide-react";
import {
  ActiveBadge,
  ActiveFilterSummary,
  AdminDataTable,
  AlertBox,
  Button,
  FilterDrawer,
  Modal,
  StatusBadge,
  TableFilterSelect,
  Truncate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { PickupPointDecision } from "./pickup-point-decision";
import { AdminPickupPointForm, type AdminPickupPointInitial } from "./admin-pickup-point-form";

export type PickupPointRow = {
  id: string;
  sellerId: string;
  seller: { shopName: string };
  name: string;
  contactPerson: string;
  mobile: string;
  line1: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  landmark: string | null;
  isDefault: boolean;
  approvalStatus: string;
  isActive: boolean;
  courierAddressRevision: number;
  rapidshypPickupName: string | null;
  rapidshypSyncedRevision: number | null;
  delhiveryWarehouseName: string | null;
  delhiverySyncedRevision: number | null;
  courierSyncError: string | null;
};

/** Registered with this courier at the point's current address. */
function courierSynced(name: string | null, syncedRevision: number | null, revision: number) {
  return !!name && syncedRevision === revision;
}

function CourierStatus({ p }: { p: PickupPointRow }) {
  if (p.approvalStatus !== "APPROVED") return <span className="text-xs text-gray-400">—</span>;
  const couriers = [
    {
      label: "RapidShyp",
      ok: courierSynced(p.rapidshypPickupName, p.rapidshypSyncedRevision, p.courierAddressRevision),
      name: p.rapidshypPickupName,
    },
    {
      label: "Delhivery",
      ok: courierSynced(p.delhiveryWarehouseName, p.delhiverySyncedRevision, p.courierAddressRevision),
      name: p.delhiveryWarehouseName,
    },
  ];
  return (
    <div className="flex flex-col items-start gap-0.5 text-xs">
      {couriers.map((c) => (
        <span
          key={c.label}
          title={c.name ?? undefined}
          className={c.ok ? "font-medium text-success" : "font-medium text-danger"}
        >
          {c.ok ? "✓" : "✗"} {c.label}
        </span>
      ))}
      {p.courierSyncError && (
        <Truncate value={p.courierSyncError} maxWidth="200px" className="text-[11px] text-danger" />
      )}
    </div>
  );
}

const FILTER_KEYS = ["status", "active"];

function toInitial(p: PickupPointRow): AdminPickupPointInitial {
  return {
    id: p.id,
    sellerId: p.sellerId,
    sellerName: p.seller.shopName,
    name: p.name,
    contactPerson: p.contactPerson,
    mobile: p.mobile,
    line1: p.line1,
    city: p.city,
    district: p.district,
    state: p.state,
    pincode: p.pincode,
    landmark: p.landmark,
    isDefault: p.isDefault,
    isActive: p.isActive,
  };
}

export function PickupPointsTable({
  pickupPoints,
  sellers,
  total,
  page,
  pageSize,
}: {
  pickupPoints: PickupPointRow[];
  sellers: { id: string; shopName: string }[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  // null = closed; "new" = add form; a row = edit that row.
  const [editing, setEditing] = useState<"new" | PickupPointRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handleSaved(warning?: string) {
    setEditing(null);
    setNotice(warning ?? null);
    router.refresh();
  }

  const columns: DataTableColumn<PickupPointRow>[] = [
    {
      key: "seller",
      header: "Seller",
      primary: true,
      value: (p) => p.seller.shopName,
      render: (p) => <span className="font-semibold text-ink">{p.seller.shopName}</span>,
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      value: (p) => p.name,
      render: (p) => <span className="text-ink">{p.name}</span>,
    },
    {
      key: "address",
      header: "Address",
      truncate: true,
      value: (p) => `${p.line1}, ${p.city}, ${p.state} - ${p.pincode}`,
      render: (p) => (
        <Truncate
          value={`${p.line1}, ${p.city}, ${p.state} - ${p.pincode}`}
          maxWidth="280px"
          className="text-gray-600"
        />
      ),
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (p) => p.approvalStatus,
      render: (p) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={p.approvalStatus} />
          {!p.isActive && <ActiveBadge active={false} />}
        </div>
      ),
    },
    {
      key: "couriers",
      header: "Couriers",
      value: (p) =>
        [
          courierSynced(p.rapidshypPickupName, p.rapidshypSyncedRevision, p.courierAddressRevision) &&
            "RapidShyp",
          courierSynced(p.delhiveryWarehouseName, p.delhiverySyncedRevision, p.courierAddressRevision) &&
            "Delhivery",
        ]
          .filter(Boolean)
          .join(", "),
      render: (p) => <CourierStatus p={p} />,
      mobileHidden: true,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <AlertBox tone="warning">
          <div className="flex items-start justify-between gap-4">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        </AlertBox>
      )}

      <AdminDataTable
        data={pickupPoints}
        columns={columns}
        rowKey={(p) => p.id}
        renderActions={(p) => (
          <PickupPointDecision
            pickupPointId={p.id}
            status={p.approvalStatus}
            onEdit={() => {
              setNotice(null);
              setEditing(p);
            }}
            onNotice={setNotice}
          />
        )}
        toolbarActions={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setNotice(null);
              setEditing("new");
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add pickup point
          </Button>
        }
        caption="Seller pickup points"
        searchPlaceholder="Search by seller, pickup point, or city…"
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
              label="Any active status"
              options={[
                { value: "yes", label: "Active" },
                { value: "no", label: "Inactive" },
              ]}
            />
          </FilterDrawer>
        }
        clearFiltersAction={
          <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
        }
        emptyIcon={<MapPinned className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No pickup points submitted yet"
      />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add pickup point on behalf of a seller" : "Edit pickup point"}
      >
        {editing !== null && (
          <AdminPickupPointForm
            sellers={sellers}
            initial={editing === "new" ? undefined : toInitial(editing)}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
