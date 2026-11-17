"use client";

import { useState, useTransition } from "react";
import { Copy, Check, KeyRound } from "lucide-react";
import { Button, Modal } from "@kisan4u/ui";
import { resetSellerPasswordAction } from "./actions";

/**
 * Admin-only action on the seller detail page. Generates a brand-new
 * temporary password server-side (never chosen by the admin — see
 * packages/auth/src/password-reset.ts:generateTemporaryPassword) and shows
 * it exactly once in this modal; it is not stored anywhere retrievable
 * after this, so the admin must copy/hand it off now. The seller is
 * forced to set their own password on next login before reaching anything
 * else (User.mustChangePassword — see apps/dashboard/src/app/change-password).
 */
export function ResetPasswordButton({
  userId,
  sellerName,
}: {
  userId: string;
  sellerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openModal() {
    setConfirming(true);
    setTemporaryPassword(null);
    setCopied(false);
    setError(null);
    setOpen(true);
  }

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const result = await resetSellerPasswordAction(userId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTemporaryPassword(result.temporaryPassword ?? null);
      setConfirming(false);
    });
  }

  async function handleCopy() {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openModal}>
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        Reset password
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Reset password">
        <div className="flex flex-col gap-3">
          {confirming && (
            <>
              <p className="text-sm text-gray-700">
                This generates a new temporary password for <strong>{sellerName}</strong>&apos;s
                login and signs them out of any device they&apos;re currently logged in on.
                They&apos;ll be required to set their own password the next time they sign in.
              </p>
              {error && (
                <span role="alert" className="text-xs font-medium text-danger">
                  {error}
                </span>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={handleReset} loading={isPending}>
                  Generate temporary password
                </Button>
              </div>
            </>
          )}

          {temporaryPassword && (
            <>
              <p className="text-sm text-gray-700">
                Share this with the seller now — it will not be shown again. They&apos;ll be
                prompted to set their own password on first login.
              </p>
              <div className="flex items-center gap-2 rounded-md border-[1.5px] border-border bg-bg-dashboard/60 px-3 py-2.5">
                <code className="flex-1 select-all break-all font-mono text-sm text-ink">
                  {temporaryPassword}
                </code>
                <Button type="button" size="sm" variant="ghost" onClick={handleCopy}>
                  {copied ? (
                    <Check className="h-4 w-4 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
