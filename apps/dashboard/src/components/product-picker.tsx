"use client";

import { useState, useTransition } from "react";
import { Button, Modal } from "@kisan4u/ui";

export type PickerProduct = {
  id: string;
  name: string;
  slug: string;
  primaryImageUrl?: string | null;
};

/**
 * Shared reorderable product-selection control (search + add + reorder +
 * remove), used by the Discovery, Featured-by-Category, and Deal-of-the-
 * Day admin screens instead of three near-duplicate pickers — matching
 * how MasterDataManager already shares simple CRUD UI in this codebase.
 */
export function ProductPicker({
  selected,
  onChange,
  onSearch,
  max,
}: {
  selected: PickerProduct[];
  onChange: (products: PickerProduct[]) => void;
  onSearch: (query: string) => Promise<PickerProduct[]>;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerProduct[]>([]);
  const [isPending, startTransition] = useTransition();

  const selectedIds = new Set(selected.map((p) => p.id));
  const atMax = max != null && selected.length >= max;

  function runSearch(q: string) {
    setQuery(q);
    startTransition(async () => {
      const found = await onSearch(q);
      setResults(found);
    });
  }

  function openPicker() {
    setOpen(true);
    runSearch("");
  }

  function add(product: PickerProduct) {
    if (atMax || selectedIds.has(product.id)) return;
    onChange([...selected, product]);
  }

  function remove(id: string) {
    onChange(selected.filter((p) => p.id !== id));
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...selected];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <div>
      <ol className="mb-2 flex flex-col gap-1.5">
        {selected.map((p, i) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="w-5 text-xs font-bold text-gray-400">{i + 1}</span>
            <span className="flex-1 font-medium text-ink">{p.name}</span>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="text-xs disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === selected.length - 1}
              className="text-xs disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="text-xs font-bold text-danger"
            >
              Remove
            </button>
          </li>
        ))}
        {selected.length === 0 && (
          <li className="text-xs text-gray-500">No products selected yet.</li>
        )}
      </ol>

      <Button type="button" variant="outline" size="sm" onClick={openPicker} disabled={atMax}>
        {atMax ? `Maximum ${max} reached` : "+ Add product"}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add product">
        <input
          autoFocus
          placeholder="Search by name…"
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          className="mb-3 w-full rounded-md border-[1.5px] border-border px-3 py-2 text-sm outline-none focus:border-green-600"
        />
        {isPending && <p className="text-xs text-gray-500">Searching…</p>}
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {results.map((p) => {
            const already = selectedIds.has(p.id);
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-green-50"
              >
                <span className="text-sm text-ink">{p.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant={already ? "ghost" : "secondary"}
                  disabled={already}
                  onClick={() => add(p)}
                >
                  {already ? "Added" : "Add"}
                </Button>
              </li>
            );
          })}
          {!isPending && results.length === 0 && (
            <li className="py-4 text-center text-xs text-gray-500">No products found.</li>
          )}
        </ul>
      </Modal>
    </div>
  );
}
