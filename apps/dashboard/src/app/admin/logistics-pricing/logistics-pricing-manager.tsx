"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  AlertBox,
  Button,
  Card,
  FormInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
} from "@kisan4u/ui";

type SlabRow = { lowerGrams: number; upperGrams: number; priceStr: string };

export type LogisticsConfigInitial = {
  id: string;
  maxWeightGrams: number;
  aboveMaxPrice: string;
  isActive: boolean;
  slabs: Array<{ lowerWeightGrams: number; upperWeightGrams: number; price: string }>;
};

type Result = { ok: true } | { ok: false; error: string };

function gramsToKgStr(grams: number): string {
  return (grams / 1000).toString();
}
function kgStrToGrams(kg: string): number {
  return Math.round(Number(kg || "0") * 1000);
}

const CELL_INPUT =
  "w-full rounded-md border-[1.5px] border-border px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-green-600";

/**
 * Weight is always stored/validated in whole grams (never floating-point
 * kilograms — see packages/catalog/src/logistics-pricing.ts) but the admin
 * types kilograms; every kg input immediately converts to an integer gram
 * value on change, so the value this component ever sends to the server
 * is already gram-integer, matching the spec's own reasoning about
 * decimal-kg precision bugs.
 */
export function LogisticsPricingManager({
  initial,
  onSave,
}: {
  initial: LogisticsConfigInitial | null;
  onSave: (
    configId: string | null,
    input: {
      maxWeightGrams: number;
      aboveMaxPrice: number;
      isActive: boolean;
      slabs: Array<{ lowerWeightGrams: number; upperWeightGrams: number; price: number }>;
    },
  ) => Promise<Result>;
}) {
  const router = useRouter();
  const [maxWeightGrams, setMaxWeightGrams] = useState(initial?.maxWeightGrams ?? 3000);
  const [aboveMaxPrice, setAboveMaxPrice] = useState(initial?.aboveMaxPrice ?? "0");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [slabs, setSlabs] = useState<SlabRow[]>(
    initial?.slabs.map((s) => ({
      lowerGrams: s.lowerWeightGrams,
      upperGrams: s.upperWeightGrams,
      priceStr: s.price,
    })) ?? [{ lowerGrams: 0, upperGrams: 3000, priceStr: "0" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function updateSlab(index: number, patch: Partial<SlabRow>) {
    setSlabs((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addSlab() {
    const last = slabs[slabs.length - 1];
    const lowerGrams = last ? last.upperGrams + 1 : 0;
    setSlabs((prev) => [...prev, { lowerGrams, upperGrams: maxWeightGrams, priceStr: "0" }]);
  }
  function removeSlab(index: number) {
    setSlabs((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await onSave(initial?.id ?? null, {
        maxWeightGrams,
        aboveMaxPrice: Number(aboveMaxPrice || "0"),
        isActive,
        slabs: slabs.map((s) => ({
          lowerWeightGrams: s.lowerGrams,
          upperWeightGrams: s.upperGrams,
          price: Number(s.priceStr || "0"),
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="mb-4 text-[15px] font-extrabold text-green-800">Master settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput
            label="Maximum slab weight (kg)"
            type="number"
            step="0.001"
            value={gramsToKgStr(maxWeightGrams)}
            onChange={(e) => setMaxWeightGrams(kgStrToGrams(e.target.value))}
          />
          <FormInput
            label="Standard price above maximum weight"
            type="number"
            value={aboveMaxPrice}
            onChange={(e) => setAboveMaxPrice(e.target.value)}
          />
        </div>
        <label className="mt-4 flex items-center gap-1.5 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-[15px] font-extrabold text-green-800">Weight slabs</h2>
        <p className="mb-4 text-xs text-gray-600">
          Every gram from 0 up to the maximum weight must belong to exactly one slab — no gaps, no
          overlaps, no repeated boundaries. Weight is stored in whole grams internally; enter
          kilograms here for convenience.
        </p>

        <TableShell>
          <Table className="min-w-[480px]">
            <TableHead>
              <tr>
                <TableHeaderCell>Lower (kg)</TableHeaderCell>
                <TableHeaderCell>Upper (kg)</TableHeaderCell>
                <TableHeaderCell>Price</TableHeaderCell>
                <TableHeaderCell align="right">
                  <span className="sr-only">Remove</span>
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {slabs.map((slab, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <input
                      type="number"
                      step="0.001"
                      value={gramsToKgStr(slab.lowerGrams)}
                      onChange={(e) =>
                        updateSlab(index, { lowerGrams: kgStrToGrams(e.target.value) })
                      }
                      onWheel={(e) => e.currentTarget.blur()}
                      aria-label={`Slab ${index + 1} lower weight (kg)`}
                      className={CELL_INPUT}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="number"
                      step="0.001"
                      value={gramsToKgStr(slab.upperGrams)}
                      onChange={(e) =>
                        updateSlab(index, { upperGrams: kgStrToGrams(e.target.value) })
                      }
                      onWheel={(e) => e.currentTarget.blur()}
                      aria-label={`Slab ${index + 1} upper weight (kg)`}
                      className={CELL_INPUT}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="number"
                      value={slab.priceStr}
                      onChange={(e) => updateSlab(index, { priceStr: e.target.value })}
                      onWheel={(e) => e.currentTarget.blur()}
                      aria-label={`Slab ${index + 1} price`}
                      className={CELL_INPUT}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSlab(index)}
                      aria-label={`Remove slab ${index + 1}`}
                      className="text-danger hover:bg-danger-bg"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>

        <Button type="button" variant="outline" size="sm" onClick={addSlab} className="mt-3">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add slab
        </Button>
      </Card>

      {error && <AlertBox tone="danger">{error}</AlertBox>}
      {success && <AlertBox tone="success">Saved.</AlertBox>}

      <div>
        <Button type="button" variant="primary" onClick={handleSave} loading={isPending}>
          Save logistics pricing
        </Button>
      </div>
    </div>
  );
}
