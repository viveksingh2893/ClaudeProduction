"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { listFeaturedByCategoryCollections } from "@kisan4u/catalog";
import { AlertBox, Button, Card, ConfirmDialog, FormSelect } from "@kisan4u/ui";
import { ProductPicker, type PickerProduct } from "@/components/product-picker";
import {
  addFeaturedCategoryAction,
  removeFeaturedCategoryAction,
  setCollectionItemsAction,
  searchProductsAction,
} from "../actions";

type Collection = Awaited<ReturnType<typeof listFeaturedByCategoryCollections>>[number];

function OneCategorySection({ collection }: { collection: Collection }) {
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
      );
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function confirmRemoveCategory() {
    startTransition(async () => {
      await removeFeaturedCategoryAction(collection.id);
      setConfirmRemove(false);
      router.refresh();
    });
  }

  const categoryName = collection.category?.name ?? "Unknown category";

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold text-green-800">{categoryName}</h2>
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={isPending}
          onClick={() => setConfirmRemove(true)}
        >
          Remove category
        </Button>
      </div>
      <ProductPicker
        selected={items}
        onChange={saveItems}
        onSearch={searchProductsAction}
        max={10}
      />
      {error && (
        <AlertBox tone="danger" className="mt-3">
          {error}
        </AlertBox>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={confirmRemoveCategory}
        title={`Remove "${categoryName}" from Featured by Category?`}
        description="This removes the whole section and its curated product list from the homepage. This can't be undone."
        confirmLabel="Remove category"
        isPending={isPending}
      />
    </Card>
  );
}

export function FeaturedByCategoryManager({
  collections,
  categories,
}: {
  collections: Collection[];
  categories: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState("");

  const usedCategoryIds = new Set(
    collections.map((c) => c.categoryId).filter((v): v is string => v != null),
  );
  const availableCategories = categories.filter((c) => !usedCategoryIds.has(c.id));

  function addCategory() {
    if (!pendingCategoryId) return;
    setError(null);
    startTransition(async () => {
      const result = await addFeaturedCategoryAction(pendingCategoryId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingCategoryId("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {collections.map((c) => (
        <OneCategorySection key={c.id} collection={c} />
      ))}

      {collections.length < 5 && (
        <div className="flex items-end gap-2 rounded-xl border border-dashed border-border p-4">
          <FormSelect
            label="Add a featured category"
            value={pendingCategoryId}
            onChange={(e) => setPendingCategoryId(e.target.value)}
          >
            <option value="">— Select —</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!pendingCategoryId || isPending}
            onClick={addCategory}
          >
            Add
          </Button>
        </div>
      )}
      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
