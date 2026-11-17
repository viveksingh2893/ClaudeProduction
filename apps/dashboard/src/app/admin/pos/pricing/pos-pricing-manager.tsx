"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PosPricingConfigView } from "@kisan4u/orders";
import { Button, Card, FormInput, AlertBox } from "@kisan4u/ui";
import { savePosPricingConfigAction } from "./actions";

export function PosPricingManager({ config }: { config: PosPricingConfigView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [codDiscountPercent, setCodDiscountPercent] = useState(String(config.codDiscountPercent));
  const [fullPrepaidDiscountPercent, setFullPrepaidDiscountPercent] = useState(
    String(config.fullPrepaidDiscountPercent),
  );
  const [partialPrepaidDiscountPercent, setPartialPrepaidDiscountPercent] = useState(
    String(config.partialPrepaidDiscountPercent),
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await savePosPricingConfigAction({
        codDiscountPercent: Number(codDiscountPercent),
        fullPrepaidDiscountPercent: Number(fullPrepaidDiscountPercent),
        partialPrepaidDiscountPercent: Number(partialPrepaidDiscountPercent),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="mb-1 text-base font-bold text-ink">Discount by payment mode</h2>
        <p className="mb-3 text-sm text-gray-600">
          Applied to the pre-tax product total before tax is calculated on what remains.
        </p>
        <div className="flex flex-col gap-3">
          <FormInput
            label="COD — discount %"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={codDiscountPercent}
            onChange={(e) => setCodDiscountPercent(e.target.value)}
            required
          />
          <FormInput
            label="Full prepaid — discount %"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={fullPrepaidDiscountPercent}
            onChange={(e) => setFullPrepaidDiscountPercent(e.target.value)}
            required
          />
          <FormInput
            label="Partial prepaid — discount %"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={partialPrepaidDiscountPercent}
            onChange={(e) => setPartialPrepaidDiscountPercent(e.target.value)}
            required
          />
        </div>
      </Card>

      <AlertBox tone="info">
        For a partial-prepaid order, the amount collected now is entered per-order by whoever is
        placing it in POS — the rest is automatically the COD balance.
      </AlertBox>

      {error && <AlertBox tone="danger">{error}</AlertBox>}
      {saved && <AlertBox tone="success">Saved.</AlertBox>}

      <Button type="submit" variant="primary" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
