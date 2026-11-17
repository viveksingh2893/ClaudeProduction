"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button, Modal, StatusBadge, formatCurrency, formatDate } from "@kisan4u/ui";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { loadCustomerOrderHistoryAction, type OrderHistoryEntry } from "../actions";

/**
 * "View order history" for this order's customer/dealer, right from the
 * order detail page's Customer Details card — same read-only past-orders
 * view POS gives a sales agent (pos/components/pos-order-history-modal.tsx),
 * so scheduling staff don't have to navigate away to see it.
 */
export function CustomerOrderHistoryButton({
  customerId,
  label,
}: {
  customerId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<OrderHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    loadCustomerOrderHistoryAction(customerId)
      .then(setEntries)
      .catch(() => setError("Could not load order history."))
      .finally(() => setLoading(false));
  }, [open, customerId]);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        Order history
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Past orders · ${label}`} className="max-w-2xl">
        {loading ? (
          <p className="text-[13px] text-gray-500">Loading past orders…</p>
        ) : error ? (
          <p className="text-[13px] font-medium text-danger">{error}</p>
        ) : !entries || entries.length === 0 ? (
          <p className="text-[13px] text-gray-500">No previous orders for this account yet.</p>
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
                        {it.variantLabel ? <span className="text-gray-400"> · {it.variantLabel}</span> : null}
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
    </>
  );
}
