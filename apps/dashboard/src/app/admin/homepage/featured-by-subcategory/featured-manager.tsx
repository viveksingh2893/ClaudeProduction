"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { listFeaturedBySubcategoryCollections } from "@kisan4u/catalog";
import { AlertBox, Button, Card, ConfirmDialog, FormSelect } from "@kisan4u/ui";
import { ProductPicker, type PickerProduct } from "@/components/product-picker";
import {
  addFeaturedSubcategoryAction,
  removeFeaturedSubcategoryAction,
  setCollectionItemsAction,
  searchProductsAction,
} from "../actions";

type Collection = Awaited<ReturnType<typeof listFeaturedBySubcategoryCollections>>[number];
type SubcategoryOption = { id: string; name: string; category: { name: string } };

function OneSubcategorySection({ collection }: { collection: Collection }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PickerProduct[]>(collection.items.map((i) => i.product));
  const [confirmRemove, setConfirmRemove] = useState(false);

  function saveItems(next: PickerProduct[]) {
    setItems(next);
    setError(null);
    startTransition(async () => {
      const result = await setCollectionItemsAction(
        collection.id,
        next.map((p) => p.id),
        12,
      );
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function confirmRemoveSubcategory() {
    startTransition(async () => {
      await removeFeaturedSubcategoryAction(collection.id);
      setConfirmRemove(false);
      router.refresh();
    });
  }

  const subcategoryName = collection.subCategory?.name ?? "Unknown sub-category";

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold text-green-800">{subcategoryName}</h2>
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={isPending}
          onClick={() => setConfirmRemove(true)}
        >
          Remove ranking
        </Button>
      </div>
      <ProductPicker
        selected={items}
        onChange={saveItems}
        onSearch={searchProductsAction}
        max={12}
      />
      {error && (
        <AlertBox tone="danger" className="mt-3">
          {error}
        </AlertBox>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={confirmRemoveSubcategory}
        title={`Remove "${subcategoryName}" from Featured by Sub-category?`}
        description="This clears its curated product list — the homepage row falls back to random products instead of disappearing."
        confirmLabel="Remove ranking"
        isPending={isPending}
      />
    </Card>
  );
}

export function FeaturedBySubcategoryManager({
  collections,
  subcategories,
}: {
  collections: Collection[];
  subcategories: SubcategoryOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingSubcategoryId, setPendingSubcategoryId] = useState("");

  const usedSubcategoryIds = new Set(
    collections.map((c) => c.subCategoryId).filter((v): v is string => v != null),
  );
  const availableSubcategories = subcategories.filter((s) => !usedSubcategoryIds.has(s.id));

  function addSubcategory() {
    if (!pendingSubcategoryId) return;
    setError(null);
    startTransition(async () => {
      const result = await addFeaturedSubcategoryAction(pendingSubcategoryId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingSubcategoryId("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {collections.map((c) => (
        <OneSubcategorySection key={c.id} collection={c} />
      ))}

      <div className="flex items-end gap-2 rounded-xl border border-dashed border-border p-4">
        <FormSelect
          label="Rank a sub-category"
          value={pendingSubcategoryId}
          onChange={(e) => setPendingSubcategoryId(e.target.value)}
        >
          <option value="">— Select —</option>
          {availableSubcategories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.category.name} / {s.name}
            </option>
          ))}
        </FormSelect>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!pendingSubcategoryId || isPending}
          onClick={addSubcategory}
        >
          Add
        </Button>
      </div>
      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
