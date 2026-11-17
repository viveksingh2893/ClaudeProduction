"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { listHomepageSections } from "@kisan4u/catalog";
import { AlertBox, Button, RecordList, RecordListRow } from "@kisan4u/ui";
import { saveHomepageSectionAction } from "./actions";

type Section = Awaited<ReturnType<typeof listHomepageSections>>[number];

const LABELS: Record<string, string> = {
  HERO_BANNER: "Hero banner carousel",
  TRUST_STRIP: "Trust strip (4 benefits — copy is hardcoded, block only)",
  COUPON_STRIP: "Coupon strip",
  TOP_CATEGORIES: "Top Categories",
  DEAL_OF_THE_DAY: "Deal of the Day",
  PRODUCT_DISCOVERY_TRENDING: "Product Discovery — Trending",
  PRODUCT_DISCOVERY_BEST_SELLERS: "Product Discovery — Best Sellers",
  PRODUCT_DISCOVERY_NEW_ARRIVALS: "Product Discovery — New Arrivals",
  JOIN_DEALER_SELLER: "Become a Dealer / Become a Seller",
  FEATURED_BY_CATEGORY: "Featured Products by Category",
  SHOP_BY_BRAND: "Shop by Brand",
};

function toLocalInputValue(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 16);
}

export function HomepageSectionsManager({ sections }: { sections: Section[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(
    sections.map((s) => ({
      id: s.id,
      type: s.type,
      position: s.position,
      enabled: s.enabled,
      audience: s.audience,
      startAt: toLocalInputValue(s.startAt),
      endAt: toLocalInputValue(s.endAt),
    })),
  );

  function updateRow(id: string, patch: Partial<(typeof rows)[number]>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function save(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setError(null);
    startTransition(async () => {
      const result = await saveHomepageSectionAction({
        id: row.id,
        position: row.position,
        enabled: row.enabled,
        audience: row.audience,
        startAt: row.startAt || undefined,
        endAt: row.endAt || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <RecordList>
        {[...rows]
          .sort((a, b) => a.position - b.position)
          .map((row) => (
            <RecordListRow key={row.id}>
              <div className="min-w-[220px] flex-1 text-sm font-bold text-ink">{LABELS[row.type] ?? row.type}</div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <input type="checkbox" checked={row.enabled} onChange={(e) => updateRow(row.id, { enabled: e.target.checked })} />
                Enabled
              </label>
              <input
                type="number"
                value={row.position}
                onChange={(e) => updateRow(row.id, { position: Number(e.target.value) })}
                className="w-16 rounded-md border-[1.5px] border-border px-2 py-1.5 text-sm"
                aria-label="Position"
              />
              <select
                value={row.audience}
                onChange={(e) => updateRow(row.id, { audience: e.target.value as (typeof row)["audience"] })}
                className="rounded-md border-[1.5px] border-border bg-white px-2 py-1.5 text-sm"
                aria-label="Audience"
              >
                <option value="COMMON">Common</option>
                <option value="CUSTOMER">Customer only</option>
                <option value="DEALER">Dealer only</option>
              </select>
              <input
                type="datetime-local"
                value={row.startAt}
                onChange={(e) => updateRow(row.id, { startAt: e.target.value })}
                className="rounded-md border-[1.5px] border-border px-2 py-1.5 text-xs"
                title="Start (optional)"
              />
              <input
                type="datetime-local"
                value={row.endAt}
                onChange={(e) => updateRow(row.id, { endAt: e.target.value })}
                className="rounded-md border-[1.5px] border-border px-2 py-1.5 text-xs"
                title="End (optional)"
              />
              <Button type="button" size="sm" variant="secondary" disabled={isPending} onClick={() => save(row.id)}>
                Save
              </Button>
            </RecordListRow>
          ))}
      </RecordList>
    </div>
  );
}
