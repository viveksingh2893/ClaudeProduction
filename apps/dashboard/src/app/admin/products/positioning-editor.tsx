"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Modal, Button, Badge, FormInput, FormSelect, AlertBox } from "@kisan4u/ui";
import {
  setFeaturedPositionAction,
  setProductPlacementAction,
  setProductCategoryPlacementAction,
} from "./actions";

type Section = "TRENDING" | "BEST_SELLERS" | "NEW_ARRIVALS";

export type ProductPositioning = {
  featuredPosition: number | null;
  trending: number | null;
  bestSeller: number | null;
  newArrival: number | null;
  categoryRank: number | null;
};

const SECTION_MAX: Record<Section, number> = {
  TRENDING: 10,
  BEST_SELLERS: 12,
  NEW_ARRIVALS: 10,
};

function rankOptions(max: number) {
  return Array.from({ length: max }, (_, i) => i + 1);
}

/**
 * The single "Positioning" cell for the /admin/products table — every
 * homepage placement control for one product in one place: Featured
 * position, Best Seller rank, Category rank (within the product's own
 * category), Trending rank, New Arrival rank. Replaces the old separate
 * "Featured pos." + "Homepage placement" columns. Each changed field is
 * its own server call (the sections are independently ordered) so one
 * rejection never blocks the others.
 */
export function PositioningEditor({
  productId,
  productName,
  categoryName,
  value,
}: {
  productId: string;
  productName: string;
  categoryName: string;
  value: ProductPositioning;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductPositioning>(value);

  function openModal() {
    setDraft(value);
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      if (draft.featuredPosition !== value.featuredPosition) {
        const r = await setFeaturedPositionAction(productId, draft.featuredPosition);
        if (!r.ok) return fail(`Featured position: ${r.error}`);
      }
      const sections: [Section, number | null, number | null, string][] = [
        ["BEST_SELLERS", draft.bestSeller, value.bestSeller, "Best Seller"],
        ["TRENDING", draft.trending, value.trending, "Trending"],
        ["NEW_ARRIVALS", draft.newArrival, value.newArrival, "New Arrival"],
      ];
      for (const [section, next, prev, label] of sections) {
        if (next === prev) continue;
        const r = await setProductPlacementAction({ productId, section, position: next });
        if (!r.ok) return fail(`${label}: ${r.error}`);
      }
      if (draft.categoryRank !== value.categoryRank) {
        const r = await setProductCategoryPlacementAction({
          productId,
          position: draft.categoryRank,
        });
        if (!r.ok) return fail(`Category rank: ${r.error}`);
      }
      setOpen(false);
      router.refresh();
    });
  }

  function fail(message: string) {
    setError(message);
    router.refresh();
  }

  const badges: { key: string; label: string }[] = [];
  if (value.featuredPosition != null) badges.push({ key: "f", label: `Featured ${value.featuredPosition}` });
  if (value.bestSeller != null) badges.push({ key: "b", label: `Best #${value.bestSeller}` });
  if (value.categoryRank != null) badges.push({ key: "c", label: `Category #${value.categoryRank}` });
  if (value.trending != null) badges.push({ key: "t", label: `Trending #${value.trending}` });
  if (value.newArrival != null) badges.push({ key: "n", label: `New #${value.newArrival}` });

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {badges.length > 0 ? (
          badges.map((b) => (
            <Badge key={b.key} tone="success">
              {b.label}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-gray-400">Not placed</span>
        )}
        <button
          type="button"
          onClick={openModal}
          title="Edit positioning"
          aria-label="Edit positioning"
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-green-50 hover:text-ink"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Positioning — ${productName}`}>
        <div className="flex flex-col gap-3">
          <FormInput
            label="Featured position"
            hint="Lower shows first. Blank = not featured."
            type="number"
            min={1}
            value={draft.featuredPosition != null ? String(draft.featuredPosition) : ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                featuredPosition: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
          <RankSelect
            label="Best Seller rank"
            max={SECTION_MAX.BEST_SELLERS}
            value={draft.bestSeller}
            onChange={(v) => setDraft((d) => ({ ...d, bestSeller: v }))}
          />
          <RankSelect
            label={`Category rank — ${categoryName}`}
            max={10}
            value={draft.categoryRank}
            onChange={(v) => setDraft((d) => ({ ...d, categoryRank: v }))}
          />
          <RankSelect
            label="Trending rank"
            max={SECTION_MAX.TRENDING}
            value={draft.trending}
            onChange={(v) => setDraft((d) => ({ ...d, trending: v }))}
          />
          <RankSelect
            label="New Arrival rank"
            max={SECTION_MAX.NEW_ARRIVALS}
            value={draft.newArrival}
            onChange={(v) => setDraft((d) => ({ ...d, newArrival: v }))}
          />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={submit} loading={isPending}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function RankSelect({
  label,
  max,
  value,
  onChange,
}: {
  label: string;
  max: number;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <FormSelect
      label={label}
      value={value != null ? String(value) : "none"}
      onChange={(e) => onChange(e.target.value === "none" ? null : Number(e.target.value))}
    >
      <option value="none">Not shown</option>
      {rankOptions(max).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </FormSelect>
  );
}
