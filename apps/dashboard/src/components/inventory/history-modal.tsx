"use client";

import { useEffect, useState } from "react";
import { AlertBox, Button, Modal, formatDate } from "@kisan4u/ui";
import {
  ADJUSTMENT_TYPE_LABEL,
  rowTarget,
  type InventoryActions,
  type InventoryRowDTO,
  type StockAdjustmentRowDTO,
} from "./types";

const PAGE_SIZE = 20;

export function HistoryModal({
  row,
  actions,
  showPerformer,
  onClose,
}: {
  row: InventoryRowDTO;
  actions: InventoryActions;
  /** Admin sees who made every change; the seller's own history view doesn't need to repeat "you" on every row (and never shows another party's internal identity beyond the role). */
  showPerformer: boolean;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StockAdjustmentRowDTO[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    actions.listHistory(rowTarget(row), page).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows(result.rows);
      setTotal(result.total);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Modal open onClose={onClose} title="Quantity adjustment history" className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="text-[13px] font-semibold text-ink">
          {row.productName}
          {row.variantLabel !== "Default variant" ? ` — ${row.variantLabel}` : ""}
        </div>

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && rows && rows.length === 0 && (
          <p className="text-sm text-gray-500">No stock adjustments recorded yet.</p>
        )}
        {!loading && rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-xs text-gray-500">
                  <th className="py-1.5 pr-3 font-semibold">Date</th>
                  <th className="py-1.5 pr-3 font-semibold">Type</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Previous</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Change</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">New</th>
                  {showPerformer && <th className="py-1.5 pr-3 font-semibold">By</th>}
                  <th className="py-1.5 font-semibold">Reason / reference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">
                      {formatDate(r.createdAt, true)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-ink">
                      {ADJUSTMENT_TYPE_LABEL[r.adjustmentType] ?? r.adjustmentType}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-gray-600">{r.previousQty}</td>
                    <td
                      className={`py-1.5 pr-3 text-right font-semibold ${r.changeQty >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {r.changeQty >= 0 ? `+${r.changeQty}` : r.changeQty}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">{r.newQty}</td>
                    {showPerformer && (
                      <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">
                        {r.performedByName ?? "—"} ({r.performedByRole})
                      </td>
                    )}
                    <td className="py-1.5 text-gray-600">
                      {r.reason ?? "—"}
                      {r.relatedOrderId && (
                        <span className="ml-1 text-xs text-gray-400">order {r.relatedOrderId}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-gray-500">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}

        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
