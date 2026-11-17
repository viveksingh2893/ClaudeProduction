"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormInput, FormTextarea, Modal } from "@kisan4u/ui";
import type { InventoryActions, InventoryRowDTO } from "./types";
import { rowTarget } from "./types";

/** spec §6 "Add Quantity" — increments the current quantity atomically (packages/catalog's recordStockChange, a guarded conditional update, same pattern order deduction already uses). */
export function AddQuantityModal({
  row,
  actions,
  onClose,
}: {
  row: InventoryRowDTO;
  actions: InventoryActions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(quantity);
  const valid = quantity.trim() !== "" && Number.isInteger(parsed) && parsed > 0;
  const newQty = valid ? row.onHandQty + parsed : row.onHandQty;

  function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    actions
      .addStock(rowTarget(row), parsed, note.trim() || null)
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
    <Modal open onClose={saving ? () => {} : onClose} title="Add quantity" className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-bg-dashboard p-3 text-[13px]">
          <div className="font-semibold text-ink">
            {row.productName}
            {row.variantLabel !== "Default variant" ? ` — ${row.variantLabel}` : ""}
          </div>
          <div className="mt-1 text-gray-600">
            In stock: <span className="font-semibold text-ink">{row.onHandQty}</span> ·
            Current available: <span className="font-semibold text-ink">{row.availableQty}</span>
          </div>
        </div>

        {saved ? (
          <AlertBox tone="success">Stock updated.</AlertBox>
        ) : (
          <>
            <FormInput
              label="Quantity to add"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              error={
                quantity.trim() !== "" && !valid ? "Enter a positive whole number." : undefined
              }
            />
            <FormTextarea
              label="Note / reference (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
            {valid && (
              <p className="text-[13px] text-gray-600">
                New in-stock quantity will be{" "}
                <span className="font-semibold text-ink">{newQty}</span>.
              </p>
            )}
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button type="button" loading={saving} disabled={!valid} onClick={handleConfirm}>
                Confirm
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
