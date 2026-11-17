"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPinned, Pencil, Power, Plus } from "lucide-react";
import type { getSellerPickupPoints } from "@kisan4u/orders";
import {
  ActiveBadge,
  AdminDataTable,
  Button,
  Card,
  RowActionMenu,
  StatusBadge,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import { PickupPointForm } from "./pickup-point-form";
import { togglePickupPointActiveAction } from "./actions";

type PickupPoint = Awaited<ReturnType<typeof getSellerPickupPoints>>[number];

/**
 * A single seller's own pickup points list — inherently small (a handful
 * of dispatch locations per seller, unlike admin/pickup-points/
 * pickup-points-table.tsx which lists every seller's points and so needs
 * real server pagination). AdminDataTable's client mode (no `server`
 * prop) already provides the same search/sort/20-per-page pagination UI
 * for free over the full in-memory list, matching the client-mode choice
 * apps/dashboard/src/components/brand-manufacturer-manager.tsx makes for
 * a comparably-sized reference list.
 */
export function PickupPointsManager({ pickupPoints }: { pickupPoints: PickupPoint[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [isPending, startTransition] = useTransition();

  function close() {
    setEditing(null);
    router.refresh();
  }

  function toggleActive(id: string, isActive: boolean) {
    startTransition(async () => {
      await togglePickupPointActiveAction(id, isActive);
      router.refresh();
    });
  }

  const editingPoint =
    editing && editing !== "new" ? pickupPoints.find((p) => p.id === editing) : undefined;

  const columns: DataTableColumn<PickupPoint>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (p) => p.name,
      render: (p) => (
        <div className="flex flex-col">
          <span className="font-semibold text-ink">{p.name}</span>
          {p.isDefault && <span className="text-xs text-green-700">Default</span>}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      value: (p) => `${p.contactPerson} ${p.mobile}`,
      render: (p) => (
        <div className="flex flex-col">
          <span className="text-ink">{p.contactPerson}</span>
          <span className="text-xs text-gray-500">{p.mobile}</span>
        </div>
      ),
    },
    {
      key: "location",
      header: "City / State",
      sortable: true,
      value: (p) => `${p.city}, ${p.state}`,
      render: (p) => (
        <span className="text-gray-600">{`${p.city}, ${p.state} - ${p.pincode}`}</span>
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
          {p.approvalStatus === "REJECTED" && p.rejectionReason && (
            <span className="text-xs text-gray-500">{p.rejectionReason}</span>
          )}
        </div>
      ),
    },
  ];

  function actionsFor(point: PickupPoint): RowAction[] {
    return [
      {
        label: `Edit ${point.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setEditing(point.id),
        disabled: isPending,
      },
      {
        label: point.isActive ? `Deactivate ${point.name}` : `Activate ${point.name}`,
        icon: <Power className="h-4 w-4" aria-hidden="true" />,
        onClick: () => toggleActive(point.id, !point.isActive),
        disabled: isPending,
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {editing ? (
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-extrabold text-green-800">
            {editingPoint ? `Edit ${editingPoint.name}` : "New pickup point"}
          </h2>
          <PickupPointForm
            initial={editingPoint}
            onSaved={close}
            onCancel={() => setEditing(null)}
          />
        </Card>
      ) : (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add pickup point
          </Button>
        </div>
      )}

      <AdminDataTable
        data={pickupPoints}
        columns={columns}
        rowKey={(p) => p.id}
        renderActions={(p) => <RowActionMenu actions={actionsFor(p)} />}
        caption="Pickup points"
        searchPlaceholder="Search by name or city…"
        emptyIcon={<MapPinned className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No pickup points yet"
        emptyDescription="Add a pickup point so you can select it when accepting orders."
      />
    </div>
  );
}
