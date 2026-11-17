"use client";

/**
 * "use client" exception, same family as Modal — a dropdown needs
 * open/close state and an outside-click listener. Built on top of Button
 * (ghost/icon variant) and Modal (for the destructive-confirm flow) so row
 * actions stay visually consistent with every other button in the app
 * instead of introducing a second button language just for tables.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { Button, type ButtonVariant } from "./Button";
import { Modal } from "./Modal";

export type RowAction = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

/**
 * Compact row-action cluster: up to `maxInline` actions render directly as
 * icon buttons (with a tooltip + accessible label each), the rest collapse
 * into a "More" overflow menu — keeps wide action lists from crowding the
 * table while still surfacing the most important action at a glance.
 */
export function RowActionMenu({
  actions,
  maxInline = 2,
}: {
  actions: RowAction[];
  maxInline?: number;
}) {
  const visible = actions.filter((a) => a.label);
  const inline = visible.slice(0, maxInline);
  const overflow = visible.slice(maxInline);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex items-center justify-end gap-1">
      {inline.map((action) => (
        <IconActionButton key={action.label} action={action} />
      ))}
      {overflow.length > 0 && (
        <div className="relative" ref={ref}>
          <button
            type="button"
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-green-50 hover:text-ink"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lift"
            >
              {overflow.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    action.tone === "danger"
                      ? "text-danger hover:bg-danger-bg"
                      : "text-ink hover:bg-green-50"
                  }`}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconActionButton({ action }: { action: RowAction }) {
  return (
    <button
      type="button"
      title={action.label}
      aria-label={action.label}
      disabled={action.disabled}
      onClick={action.onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        action.tone === "danger"
          ? "text-danger hover:bg-danger-bg"
          : "text-gray-600 hover:bg-green-50 hover:text-ink"
      }`}
    >
      {action.icon}
    </button>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  isPending?: boolean;
};

/** Confirmation step for irreversible row actions (delete, reject, suspend) — built on the shared Modal so it matches every other dialog in the app. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  isPending = false,
}: ConfirmDialogProps) {
  const confirmVariant: ButtonVariant = tone === "danger" ? "danger" : "primary";
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {description && <div className="mb-4 text-sm text-gray-600">{description}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
