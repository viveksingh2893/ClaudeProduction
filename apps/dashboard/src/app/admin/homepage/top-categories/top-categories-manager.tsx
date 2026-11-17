"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import type { listCategoryHomepageAssets } from "@kisan4u/catalog";
import {
  ActiveBadge,
  AlertBox,
  Button,
  Card,
  ConfirmDialog,
  FormInput,
  FormSelect,
  RecordList,
  RecordListRow,
  RowActionMenu,
  Thumbnail,
  type RowAction,
} from "@kisan4u/ui";
import { saveCategoryHomepageAssetAction, deleteCategoryHomepageAssetAction } from "../actions";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

type Asset = Awaited<ReturnType<typeof listCategoryHomepageAssets>>[number];

const EMPTY = {
  id: undefined as string | undefined,
  categoryId: "",
  imageUrl: "",
  position: "0",
  isActive: true,
};

export function TopCategoriesManager({
  assets,
  categories,
  storefrontBaseUrl,
}: {
  assets: Asset[];
  categories: Array<{ id: string; name: string }>;
  storefrontBaseUrl?: string | null;
}) {
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null);

  const availableCategories = categories.filter(
    (c) => form.categoryId === c.id || !assets.some((a) => a.categoryId === c.id),
  );
  const sorted = [...assets].sort((a, b) => a.position - b.position);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveCategoryHomepageAssetAction({
        id: form.id,
        categoryId: form.categoryId,
        imageUrl: form.imageUrl,
        position: Number(form.position),
        isActive: form.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(EMPTY);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startTransition(async () => {
      await deleteCategoryHomepageAssetAction(id);
      setPendingDelete(null);
      if (form.id === id) setForm(EMPTY);
      router.refresh();
    });
  }

  function actionsFor(a: Asset): RowAction[] {
    return [
      {
        label: `Edit ${a.category.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () =>
          setForm({
            id: a.id,
            categoryId: a.categoryId,
            imageUrl: a.imageUrl,
            position: String(a.position),
            isActive: a.isActive,
          }),
        disabled: isPending,
      },
      {
        label: `Delete ${a.category.name}`,
        icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setPendingDelete(a),
        disabled: isPending,
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500">No top-category images configured yet.</p>
      ) : (
        <RecordList>
          {sorted.map((a) => (
            <RecordListRow key={a.id}>
              <Thumbnail src={displaySrc(a.imageUrl)} alt="" size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-bold text-ink">
                  {a.category.name}
                  <ActiveBadge active={a.isActive} />
                </div>
                <div className="truncate text-xs text-gray-500">Position {a.position}</div>
              </div>
              <RowActionMenu actions={actionsFor(a)} />
            </RecordListRow>
          ))}
        </RecordList>
      )}

      <Card className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {form.id ? "Edit" : "Add"} category image
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormSelect
              label="Category"
              required
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              disabled={isPending}
            >
              <option value="">— Select —</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="Square homepage image URL"
              required
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              disabled={isPending}
            />
            <FormInput
              label="Position"
              type="number"
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              disabled={isPending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active
          </label>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={isPending}>
              {form.id ? "Save changes" : "Add"}
            </Button>
            {form.id && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setForm(EMPTY)}
                disabled={isPending}
              >
                Cancel edit
              </Button>
            )}
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={pendingDelete ? `Delete the "${pendingDelete.category.name}" homepage image?` : ""}
        description="This removes the category's homepage tile image. This can't be undone."
        confirmLabel="Delete"
        isPending={isPending}
      />
    </div>
  );
}
