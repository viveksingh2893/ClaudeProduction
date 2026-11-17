"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Eye, MapPin, Power, PowerOff, RotateCcw, Trash2, X } from "lucide-react";
import type { ApplicationStatus } from "@kisan4u/db";
import {
  AlertBox,
  Button,
  ConfirmDialog,
  FormTextarea,
  Modal,
  RowActionMenu,
  type RowAction,
} from "@kisan4u/ui";
import { decideDealerApplicationAction, toggleUserActiveAction } from "../actions";
import { requestAdminAccountDeletionWithWalletConfirmation } from "../request-account-deletion";
import { setDealerStateAction } from "./actions";
import {
  deletionRequestHref,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

type ConfirmKind = "REJECT" | "SUSPEND";

/**
 * Every secondary dealer action (approve/reject/suspend/reinstate,
 * activate/deactivate account, change state) behind ONE three-dot menu —
 * the Dealer.png redesign explicitly moves these out of persistent
 * inline table controls (the old DealerStateForm dropdown+button sat in
 * its own column) so the row stays scannable; each still opens its own
 * confirmation/modal, same components ApplicationActions/DealerStateForm
 * used, just triggered from a menu entry instead of always-visible chrome.
 */
export function DealerRowActions({
  profileId,
  userId,
  userName,
  isActive,
  status,
  stateId,
  states,
  deletionStatus = null,
}: {
  profileId: string;
  userId: string;
  userName: string;
  isActive: boolean;
  status: ApplicationStatus;
  stateId: string | null;
  states: Array<{ id: string; name: string }>;
  deletionStatus?: ActiveDeletionStatus | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [pendingStateId, setPendingStateId] = useState(stateId ?? "");
  const [stateError, setStateError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(action: "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE", actReason?: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await decideDealerApplicationAction({
          profileId,
          action,
          reason: actReason || undefined,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setConfirmKind(null);
        setReason("");
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(
          message.toLowerCase().includes("fetch")
            ? "Couldn't reach the server. Your session may have expired — try reloading the page."
            : `Action failed: ${message}`,
        );
      }
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

  function saveState() {
    if (!pendingStateId || pendingStateId === stateId) return;
    setStateError(null);
    startTransition(async () => {
      const result = await setDealerStateAction(profileId, pendingStateId);
      if (!result.ok) {
        setStateError(result.error);
        return;
      }
      setStateModalOpen(false);
      router.refresh();
    });
  }

  const actions: RowAction[] = [
    {
      label: "Change state",
      icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
      onClick: () => {
        setPendingStateId(stateId ?? "");
        setStateError(null);
        setStateModalOpen(true);
      },
    },
  ];
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
  if (status === "APPROVED") {
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

      <Modal open={stateModalOpen} onClose={() => setStateModalOpen(false)} title="Change dealer state">
        <div className="flex flex-col gap-3">
          <select
            value={pendingStateId}
            onChange={(e) => setPendingStateId(e.target.value)}
            aria-label="Dealer state"
            className="rounded-md border-[1.5px] border-border px-3 py-2 text-sm text-ink outline-none focus:border-green-600"
          >
            <option value="">— No state —</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {stateError && <AlertBox tone="danger">{stateError}</AlertBox>}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={saveState}
              loading={isPending}
              disabled={!pendingStateId || pendingStateId === stateId}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

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
                This immediately suspends account access until reinstated. This action can be
                reversed.
              </span>
            )}
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </div>
  );
}
