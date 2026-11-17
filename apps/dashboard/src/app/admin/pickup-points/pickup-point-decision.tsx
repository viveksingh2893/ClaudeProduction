"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { AlertBox, ConfirmDialog, FormTextarea, RowActionMenu, type RowAction } from "@kisan4u/ui";
import { decidePickupPointAction, syncPickupPointToCouriersAction } from "./actions";

/**
 * Row actions for one pickup point: Edit (opens the admin form), plus
 * Approve / Reject. Approve/Reject stay available whatever the current
 * status — an admin can reject a point that was approved earlier, or
 * approve one that was rejected — only the action matching the current
 * status is hidden. An approved point also gets "Sync to couriers", which
 * (re-)registers it on RapidShyp and Delhivery.
 */
export function PickupPointDecision({
  status,
  pickupPointId,
  onEdit,
  onNotice,
}: {
  status: string;
  pickupPointId: string;
  onEdit: () => void;
  /** Courier-registration warning from an approve/sync, shown above the table. */
  onNotice: (notice: string | null) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [isPending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await decidePickupPointAction({
        pickupPointId,
        approve,
        rejectionReason: approve ? undefined : reason || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmReject(false);
      setReason("");
      onNotice(result.warning ?? null);
      router.refresh();
    });
  }

  function syncToCouriers() {
    setError(null);
    startTransition(async () => {
      const result = await syncPickupPointToCouriersAction(pickupPointId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onNotice(result.warning ?? null);
      router.refresh();
    });
  }

  const actions: RowAction[] = [
    {
      label: "Edit",
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
      onClick: onEdit,
      disabled: isPending,
    },
  ];
  if (status === "APPROVED") {
    actions.push({
      label: "Sync to couriers",
      icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
      onClick: syncToCouriers,
      disabled: isPending,
    });
  }
  if (status !== "APPROVED") {
    actions.push({
      label: "Approve",
      icon: <Check className="h-4 w-4" aria-hidden="true" />,
      onClick: () => decide(true),
      disabled: isPending,
    });
  }
  if (status !== "REJECTED") {
    actions.push({
      label: "Reject",
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      tone: "danger",
      onClick: () => setConfirmReject(true),
      disabled: isPending,
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <RowActionMenu actions={actions} maxInline={1} />
      {error && !confirmReject && (
        <span role="alert" className="text-right text-[11px] font-medium text-danger">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={confirmReject}
        onClose={() => {
          setConfirmReject(false);
          setReason("");
        }}
        onConfirm={() => decide(false)}
        title="Reject this pickup point?"
        confirmLabel="Reject"
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            <span>The seller will be notified this pickup point was rejected.</span>
            <FormTextarea
              label="Reason"
              hint="Optional, shown to the seller"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </div>
  );
}
