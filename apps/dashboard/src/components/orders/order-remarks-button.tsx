"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, MessageSquareText } from "lucide-react";
import { AlertBox, Button, FormTextarea, Modal, formatDate } from "@kisan4u/ui";
import type { OrderNoteDTO } from "@kisan4u/orders";
import {
  addOrderRemarkAction,
  loadOrderRemarksAction,
} from "@/app/admin/orders/actions";

/**
 * Orders-table Actions-column control for internal order remarks. Works at
 * any order stage — it is not tied to a status change. Shows the current
 * remark count; opens a modal listing every remark (author · role · time)
 * with a box to add another. After adding, refreshes the table so the
 * count updates.
 */
export function OrderRemarksButton({
  sellerOrderId,
  orderNumber,
  count,
}: {
  sellerOrderId: string;
  orderNumber: string;
  count: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<OrderNoteDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBody("");
    setLoading(true);
    loadOrderRemarksAction(sellerOrderId)
      .then((rows) => setNotes(rows))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, [open, sellerOrderId]);

  function add() {
    if (!body.trim()) return;
    setError(null);
    startSaving(async () => {
      const result = await addOrderRemarkAction(sellerOrderId, body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      const rows = await loadOrderRemarksAction(sellerOrderId).catch(() => null);
      if (rows) setNotes(rows);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={count > 0 ? `${count} remark${count === 1 ? "" : "s"}` : "Add a remark"}
        className={`relative inline-flex items-center rounded-md p-1.5 transition-colors hover:bg-green-50 hover:text-green-700 ${
          count > 0 ? "text-green-700" : "text-gray-500"
        }`}
      >
        {count > 0 ? (
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-green-600 px-0.5 text-[9px] font-bold leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Remarks · ${orderNumber}`} className="max-w-lg">
        <div className="flex flex-col gap-4">
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <p className="text-[13px] text-gray-500">Loading remarks…</p>
            ) : !notes || notes.length === 0 ? (
              <p className="text-[13px] text-gray-500">
                No remarks yet. Add one below — it can be added at any stage of the order and is
                internal only (never shown to the seller or customer).
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-border bg-surface-alt p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                      <span className="font-semibold text-ink">{n.authorName}</span>
                      <span className="rounded-full bg-border/60 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
                        {n.authorRole}
                      </span>
                      <span>{formatDate(n.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[13px] text-gray-700">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <FormTextarea
              label="Add a remark"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="e.g. Customer asked to delay dispatch to Monday."
            />
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={add}
                loading={saving}
                disabled={!body.trim()}
              >
                Add remark
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
