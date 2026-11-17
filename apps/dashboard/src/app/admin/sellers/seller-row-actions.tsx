"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Eye, Power, PowerOff, RotateCcw, Trash2, X } from "lucide-react";
import type { ApplicationStatus } from "@kisan4u/db";
import { AlertBox, ConfirmDialog, FormTextarea, RowActionMenu, type RowAction } from "@kisan4u/ui";
import { decideSellerApplicationAction, toggleUserActiveAction } from "../actions";
import { requestAdminAccountDeletionWithWalletConfirmation } from "../request-account-deletion";
import {
  deletionRequestHref,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";

type ConfirmKind = "REJECT" | "SUSPEND";

/** Every secondary seller action (approve/reject/suspend/reinstate, activate/deactivate account) behind ONE three-dot menu — same pattern as DealerRowActions, keeping the row scannable instead of a row of persistent buttons. */
export function SellerRowActions({
  profileId,
  userId,
  userName,
  isActive,
  status,
  deletionStatus = null,
}: {
  profileId: string;
  userId: string;
  userName: string;
  isActive: boolean;
  status: ApplicationStatus;
  deletionStatus?: ActiveDeletionStatus | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function decide(action: "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE", actReason?: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await decideSellerApplicationAction({
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
        if (result.temporaryPassword) {
          setTempPassword(result.temporaryPassword);
          setCopied(false);
          return;
        }
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
      <ConfirmDialog
        open={!!tempPassword}
        onClose={() => {
          setTempPassword(null);
          router.refresh();
        }}
        onConfirm={() => {
          setTempPassword(null);
          router.refresh();
        }}
        title="Seller approved — send them this password"
        confirmLabel="Done"
        description={
          <div className="flex flex-col gap-3 text-left">
            <span>
              Share this temporary password with the seller now. It is shown{" "}
              <strong>only once</strong>. They sign in to the dashboard with their email and this
              password, then must set their own.
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-ink">
                {tempPassword}
              </code>
              <button
                type="button"
                onClick={() => {
                  if (tempPassword) navigator.clipboard?.writeText(tempPassword);
                  setCopied(true);
                }}
                className="rounded-md border border-border px-2 py-2 text-xs font-bold text-green-700 hover:bg-green-50"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        }
      />
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
