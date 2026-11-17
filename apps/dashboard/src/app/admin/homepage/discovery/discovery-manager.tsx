"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { getDiscoveryCollection } from "@kisan4u/catalog";
import { AlertBox, Card } from "@kisan4u/ui";
import { ProductPicker, type PickerProduct } from "@/components/product-picker";
import { setDiscoveryModeAction, setCollectionItemsAction, searchProductsAction } from "../actions";

type Collection = Awaited<ReturnType<typeof getDiscoveryCollection>>;

function OneDiscoverySection({ title, collection }: { title: string; collection: Collection }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState(collection.mode);
  const [items, setItems] = useState<PickerProduct[]>(collection.items.map((i) => i.product));

  function saveMode(next: "MANUAL" | "AUTOMATIC") {
    setMode(next);
    startTransition(async () => {
      await setDiscoveryModeAction(collection.id, next);
      router.refresh();
    });
  }

  function saveItems(next: PickerProduct[]) {
    setItems(next);
    setError(null);
    startTransition(async () => {
      const result = await setCollectionItemsAction(
        collection.id,
        next.map((p) => p.id),
      );
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold text-green-800">{title}</h2>
        <select
          value={mode}
          onChange={(e) => saveMode(e.target.value as "MANUAL" | "AUTOMATIC")}
          disabled={isPending}
          className="rounded-md border-[1.5px] border-border bg-white px-2 py-1.5 text-sm text-ink"
          aria-label={`${title} mode`}
        >
          <option value="AUTOMATIC">Automatic (featured position / recency)</option>
          <option value="MANUAL">Manual curation</option>
        </select>
      </div>
      {mode === "MANUAL" && (
        <ProductPicker
          selected={items}
          onChange={saveItems}
          onSearch={searchProductsAction}
          max={10}
        />
      )}
      {mode === "AUTOMATIC" && (
        <p className="text-xs text-gray-500">
          Storefront shows the top 10 eligible products by featured position, then recency. No
          manual list needed.
        </p>
      )}
      {error && (
        <AlertBox tone="danger" className="mt-3">
          {error}
        </AlertBox>
      )}
    </Card>
  );
}

export function DiscoveryManager({
  trending,
  bestSellers,
  newArrivals,
}: {
  trending: Collection;
  bestSellers: Collection;
  newArrivals: Collection;
}) {
  return (
    <div className="flex flex-col gap-4">
      <OneDiscoverySection title="Trending" collection={trending} />
      <OneDiscoverySection title="Best Sellers" collection={bestSellers} />
      <OneDiscoverySection title="New Arrivals" collection={newArrivals} />
    </div>
  );
}
