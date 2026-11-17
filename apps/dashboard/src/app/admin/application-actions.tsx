"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, RotateCcw, X } from "lucide-react";
import type { ApplicationDecisionInput } from "@kisan4u/validators";
import { AlertBox, ConfirmDialog, FormTextarea, RowActionMenu, type RowAction } from "@kisan4u/ui";

// INACTIVE is part of the shared ApplicationStatus enum (added for
// Brand/Manufacturer's workflow) but dealer/seller applications never
// actually reach it — included here only so this component's prop type
// accepts the full enum without a cast; no action renders for it.
type Status = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
type ConfirmKind = "REJECT" | "SUSPEND";

/** Shared decision row-actions for dealer and seller application queues — the only difference between the two callers is which server action `decide` points at. */
export function ApplicationActions({
  profileId,
  status,
  decide,
}: {
  profileId: string;
  status: Status;
  decide: (
    input: ApplicationDecisionInput,
  ) => Promise<{ ok: true; temporaryPassword?: string } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function act(action: ApplicationDecisionInput["action"], actReason?: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await decide({ profileId, action, reason: actReason || undefined });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setConfirmKind(null);
        setReason("");
        if (result.temporaryPassword) {
          // Hold the row on screen until the admin acknowledges the
          // one-time password — refresh happens when they close the dialog.
          setTempPassword(result.temporaryPassword);
          setCopied(false);
          return;
        }
        router.refresh();
      } catch (err) {
        // Root cause of the network-level "Failed to fetch" this used to
        // surface as an uncaught crash was a session/cookie problem (see
        // PHASE_2_FIXES.md), now fixed at the source. This catch is a
        // second, independent layer: if the request to the server still
        // fails outright for any reason (connection drop, dev server
        // restart, genuinely offline), show it instead of crashing the
        // page with an unhandled exception.
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(
          message.toLowerCase().includes("fetch")
            ? "Couldn't reach the server. Your session may have expired — try reloading the page."
            : `Action failed: ${message}`,
        );
      }
    });
  }

  const actions: RowAction[] = [];
  if (status === "PENDING" || status === "REJECTED") {
    actions.push({
      label: "Approve",
      icon: <Check className="h-4 w-4" aria-hidden="true" />,
      onClick: () => act("APPROVE"),
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
      onClick: () => act("REINSTATE"),
      disabled: isPending,
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <RowActionMenu actions={actions} maxInline={1} />
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
          act(
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
