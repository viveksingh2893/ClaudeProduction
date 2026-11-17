"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Eye, Power, PowerOff, RotateCcw, Trash2, X } from "lucide-react";
import type { BaStatus } from "@kisan4u/db";
import { AlertBox, ConfirmDialog, FormTextarea, RowActionMenu, type RowAction } from "@kisan4u/ui";
import { toggleUserActiveAction } from "../actions";
import { requestAdminAccountDeletionWithWalletConfirmation } from "../request-account-deletion";
import { decideBaAction } from "./actions";
import {
  deletionRequestHref,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

type ConfirmKind = "REJECT" | "SUSPEND";

/** Every secondary BA action (approve/reject/suspend/reinstate, activate/deactivate account) behind ONE three-dot menu — same pattern as DealerRowActions/SellerRowActions. */
export function BaRowActions({
  baId,
  userId,
  userName,
  isActive,
  status,
  deletionStatus = null,
}: {
  baId: string;
  userId: string;
  userName: string;
  isActive: boolean;
  status: BaStatus;
  deletionStatus?: ActiveDeletionStatus | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE", actReason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await decideBaAction({ baId, decision, reason: actReason || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmKind(null);
      setReason("");
      router.refresh();
    });
  }

  function toggleActive() {
    startTransition(async () => {
      await toggleUserActiveAction({ userId, isActive: !isActive });
      router.refresh();
    });
  }

  function deleteAccount() {
    if (!window.confirm(`Schedule deletion for ${userName}?`)) return;
    startTransition(async () => {
      const result = await requestAdminAccountDeletionWithWalletConfirmation(userId, userName);
      if (!result) return;
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const actions: RowAction[] = [];
  if (status === "PENDING" || status === "REJECTED") {
    actions.push({
      label: "Approve",
      icon: <Check className="h-4 w-4" aria-hidden="true" />,
      onClick: () => decide("APPROVE"),
      disabled: isPending,
    });
  }
  if (status === "PENDING") {
    actions.push({
      label: "Reject",
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      tone: "danger",
      onClick: () => setConfirmKind("REJECT"),
      disabled: isPending,
    });
  }
  if (status === "APPROVED" || status === "BANK_SUBMITTED") {
    actions.push({
      label: "Suspend",
      icon: <Ban className="h-4 w-4" aria-hidden="true" />,
      tone: "danger",
      onClick: () => setConfirmKind("SUSPEND"),
      disabled: isPending,
    });
  }
  if (status === "SUSPENDED") {
    actions.push({
      label: "Reinstate",
      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
      onClick: () => decide("REINSTATE"),
      disabled: isPending,
    });
  }
  actions.push({
    label: isActive ? `Disable ${userName}'s account` : `Enable ${userName}'s account`,
    icon: isActive ? (
      <PowerOff className="h-4 w-4" aria-hidden="true" />
    ) : (
      <Power className="h-4 w-4" aria-hidden="true" />
    ),
    tone: isActive ? "danger" : "default",
    onClick: toggleActive,
    disabled: isPending,
  });
  actions.push(
    deletionStatus
      ? {
          label: "View deletion request",
          icon: <Eye className="h-4 w-4" aria-hidden="true" />,
          onClick: () => router.push(deletionRequestHref(deletionStatus)),
        }
      : {
          label: `Delete ${userName}'s account`,
          icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
          tone: "danger",
          onClick: deleteAccount,
          disabled: isPending,
        },
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <RowActionMenu actions={actions} />
      {error && !confirmKind && (
        <span role="alert" className="text-right text-[11px] font-medium text-danger">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={!!confirmKind}
        onClose={() => {
          setConfirmKind(null);
          setReason("");
        }}
        onConfirm={() =>
          decide(
            confirmKind === "REJECT" ? "REJECT" : "SUSPEND",
            confirmKind === "REJECT" ? reason : undefined,
          )
        }
        title={confirmKind === "REJECT" ? "Reject this application?" : "Suspend this account?"}
        confirmLabel={confirmKind === "REJECT" ? "Reject" : "Suspend"}
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            {confirmKind === "REJECT" ? (
              <>
                <span>The applicant will be notified their application was rejected.</span>
                <FormTextarea
                  label="Reason"
                  hint="Optional, shown to the applicant"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </>
            ) : (
              <span>
                This immediately suspends BA status — earnings stop accruing until reinstated.
              </span>
            )}
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </div>
  );
}
