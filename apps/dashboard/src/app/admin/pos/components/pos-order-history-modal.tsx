"use client";

import { useEffect, useState } from "react";
import { Modal, StatusBadge, formatCurrency, formatDate } from "@kisan4u/ui";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { loadPosOrderHistoryAction, type PosOrderHistoryEntry } from "../actions";

/**
 * Read-only past-orders view for the customer / dealer currently selected in
 * POS — so a sales agent can see what they've bought before and suggest
 * what they might need next. Opened from the selected-person card.
 */
export function PosOrderHistoryModal({
  open,
  onClose,
  targetUserId,
  label,
}: {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  label: string;
}) {
  const [entries, setEntries] = useState<PosOrderHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    loadPosOrderHistoryAction(targetUserId)
      .then((r) => (r.ok ? setEntries(r.data) : setError(r.error)))
      .catch(() => setError("Could not load order history."))
      .finally(() => setLoading(false));
  }, [open, targetUserId]);

  return (
    <Modal open={open} onClose={onClose} title={`Past orders · ${label}`} className="max-w-2xl">
      {loading ? (
        <p className="text-[13px] text-gray-500">Loading past orders…</p>
      ) : error ? (
        <p className="text-[13px] font-medium text-danger">{error}</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-[13px] text-gray-500">
          No previous orders for this account yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((o) => (
            <div key={o.orderNumber} className="rounded-lg border border-border bg-surface-alt p-3">
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                <span className="font-bold text-ink">{o.orderNumber}</span>
                <span className="text-gray-500">{formatDate(o.createdAt)}</span>
                <StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status] ?? o.status} />
                <span className="ml-auto font-semibold text-ink">{formatCurrency(o.totalAmount)}</span>
              </div>
              <div className="mb-2 text-[11px] text-gray-500">Seller: {o.sellerShopName}</div>
              <ul className="flex flex-col gap-1.5">
                {o.items.map((it, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded border border-border object-cover"
                      />
                    ) : (
                      <span className="h-8 w-8 shrink-0 rounded border border-border bg-white" />
                    )}
                    <span className="min-w-0 flex-1 break-words text-gray-700">
                      {it.name}
                      {it.variantLabel ? (
                        <span className="text-gray-400"> · {it.variantLabel}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-medium text-ink">
                      × {it.quantity} {it.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
