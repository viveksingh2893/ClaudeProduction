"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormInput, Modal } from "@kisan4u/ui";
import type { InventoryActions, InventoryRowDTO } from "./types";
import { rowTarget } from "./types";

export function EditThresholdsModal({
  row,
  actions,
  onClose,
}: {
  row: InventoryRowDTO;
  actions: InventoryActions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [minStockQty, setMinStockQty] = useState(String(row.minStockQty));
  const [reorderLevel, setReorderLevel] = useState(String(row.reorderLevel));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minParsed = Number(minStockQty);
  const reorderParsed = Number(reorderLevel);
  const minValid = minStockQty.trim() !== "" && Number.isInteger(minParsed) && minParsed >= 0;
  const reorderValid =
    reorderLevel.trim() !== "" && Number.isInteger(reorderParsed) && reorderParsed >= 0;
  const reorderGreater = minValid && reorderValid && reorderParsed > minParsed;

  function handleConfirm() {
    if (!minValid || !reorderValid || !reorderGreater) return;
    setSaving(true);
    setError(null);
    actions
      .editThresholds(rowTarget(row), minParsed, reorderParsed)
      .then((result) => {
        setSaving(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      })
      .catch(() => {
        setSaving(false);
        setError("Something went wrong — try again.");
      });
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} title="Edit thresholds" className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-bg-dashboard p-3 text-[13px]">
          <div className="font-semibold text-ink">
            {row.productName}
            {row.variantLabel !== "Default variant" ? ` — ${row.variantLabel}` : ""}
          </div>
        </div>

        {saved ? (
          <AlertBox tone="success">Thresholds updated.</AlertBox>
        ) : (
          <>
            <FormInput
              label="Minimum quantity"
              type="number"
              min="0"
              step="1"
              value={minStockQty}
              onChange={(e) => setMinStockQty(e.target.value)}
            />
            <FormInput
              label="Reorder level"
              type="number"
              min="0"
              step="1"
              value={reorderLevel}
              onChange={(e) => setReorderLevel(e.target.value)}
              error={
                minValid && reorderValid && !reorderGreater
                  ? "Reorder level must be greater than minimum quantity."
                  : undefined
              }
            />
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button
                type="button"
                loading={saving}
                disabled={!minValid || !reorderValid || !reorderGreater}
                onClick={handleConfirm}
              >
                Save
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
