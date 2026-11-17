"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Badge, Button, Modal } from "@kisan4u/ui";
import type { BulkStockPreviewRowDTO, InventoryActions } from "./types";

type Step = "input" | "preview" | "done";

const EXAMPLE = "KATRA-LEGACY-Kargil1-CUS-100ml-cus, 250\nKATRA-LEGACY-Miticide-DEA-250mlx1nos-dea, 40";

/**
 * "Bulk update" — paste SKU,quantity lines, validate + preview every row
 * (product/variant resolved, current vs new quantity shown, unmatched
 * SKUs flagged) before anything is written. Apply then calls the exact
 * same recordStockChange choke point as the single-row Set/correct
 * modal, once per valid row.
 */
export function BulkUpdateModal({
  onClose,
  actions,
}: {
  onClose: () => void;
  actions: Required<Pick<InventoryActions, "bulkPreview" | "bulkApply">>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<BulkStockPreviewRowDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ appliedCount: number; failureCount: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  function parseLines(): { sku: string; newQty: number }[] | null {
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    return lines.map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      const sku = parts[0] ?? "";
      const qty = Number(parts[1]);
      return { sku, newQty: qty };
    });
  }

  function preview() {
    setError(null);
    const lines = parseLines();
    if (!lines) {
      setError("Paste at least one line: SKU, new quantity");
      return;
    }
    startTransition(async () => {
      const res = await actions.bulkPreview(lines);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows(res.rows);
      setStep("preview");
    });
  }

  function apply() {
    setError(null);
    const validRows = rows.filter((r) => r.valid && r.target);
    startTransition(async () => {
      const res = await actions.bulkApply(
        validRows.map((r) => ({ target: r.target!, newQty: r.newQty })),
      );
      setResult({ appliedCount: res.appliedCount, failureCount: res.failures.length });
      setStep("done");
      router.refresh();
    });
  }

  const validCount = rows.filter((r) => r.valid).length;
  const invalidCount = rows.length - validCount;

  return (
    <Modal open onClose={onClose} title="Bulk update stock" className="max-w-2xl">
      {step === "input" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">
            One SKU per line, comma-separated from the new on-hand quantity.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={EXAMPLE}
            rows={10}
            className="w-full rounded-md border-[1.5px] border-border bg-white p-3 font-mono text-xs text-ink outline-none focus:border-green-600"
          />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={preview} loading={isPending}>
              Preview
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone="success">{validCount} ready</Badge>
            {invalidCount > 0 && <Badge tone="danger">{invalidCount} need attention</Badge>}
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="p-2">SKU</th>
                  <th className="p-2">Product</th>
                  <th className="p-2 text-right">Current</th>
                  <th className="p-2 text-right">New</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.sku}-${i}`} className={`border-t border-border ${r.valid ? "" : "bg-danger-bg/40"}`}>
                    <td className="p-2 font-mono">{r.sku || "—"}</td>
                    <td className="p-2">
                      {r.valid ? (
                        <>
                          {r.productName}
                          <span className="ml-1 text-gray-400">({r.variantLabel})</span>
                        </>
                      ) : (
                        <span className="text-danger">{r.error}</span>
                      )}
                    </td>
                    <td className="p-2 text-right">{r.currentQty ?? "—"}</td>
                    <td className="p-2 text-right font-semibold">{r.newQty}</td>
                    <td className="p-2">
                      {r.valid ? (
                        <Badge tone="success">Valid</Badge>
                      ) : (
                        <Badge tone="danger">Invalid</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("input")}>
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={apply}
              loading={isPending}
              disabled={validCount === 0}
            >
              Apply {validCount} update{validCount === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col gap-3">
          <AlertBox tone={result.failureCount === 0 ? "success" : "warning"}>
            {result.appliedCount} update{result.appliedCount === 1 ? "" : "s"} applied
            {result.failureCount > 0 ? `, ${result.failureCount} failed` : ""}.
          </AlertBox>
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
