"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormInput, FormTextarea, Modal } from "@kisan4u/ui";
import type { InventoryActions, InventoryRowDTO } from "./types";
import { rowTarget } from "./types";

/**
 * spec §6 "Set/Edit Quantity" — an absolute stock correction, never a
 * negative value, mandatory reason, confirms old vs new. Guarded
 * server-side against a stale read via `expectedPreviousQty` (optimistic
 * concurrency, same conditional-update pattern as everything else in this
 * feature) — row.onHandQty is what this modal opened with, and the
 * server refuses the write if the real value has since changed (e.g. an
 * order sale happened moments ago), rather than silently clobbering it.
 */
export function SetQuantityModal({
  row,
  actions,
  onClose,
}: {
  row: InventoryRowDTO;
  actions: InventoryActions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(row.onHandQty));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(quantity);
  const valid = quantity.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
  const reasonValid = reason.trim().length > 0;

  function handleConfirm() {
    if (!valid || !reasonValid) return;
    setSaving(true);
    setError(null);
    actions
      .setStock(rowTarget(row), parsed, row.onHandQty, reason.trim())
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
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title="Set / correct quantity"
      className="max-w-md"
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-bg-dashboard p-3 text-[13px]">
          <div className="font-semibold text-ink">
            {row.productName}
            {row.variantLabel !== "Default variant" ? ` — ${row.variantLabel}` : ""}
          </div>
          <div className="mt-1 text-gray-600">
            In stock: <span className="font-semibold text-ink">{row.onHandQty}</span>
          </div>
        </div>

        {saved ? (
          <AlertBox tone="success">Stock corrected.</AlertBox>
        ) : (
          <>
            <FormInput
              label="New quantity"
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              error={
                quantity.trim() !== "" && !valid
                  ? "Enter a whole number that is zero or greater."
                  : undefined
              }
            />
            <FormTextarea
              label="Reason for correction"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
            {valid && (
              <p className="text-[13px] text-gray-600">
                Changing from <span className="font-semibold text-ink">{row.onHandQty}</span> to{" "}
                <span className="font-semibold text-ink">{parsed}</span>.
              </p>
            )}
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button
                type="button"
                loading={saving}
                disabled={!valid || !reasonValid}
                onClick={handleConfirm}
              >
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
