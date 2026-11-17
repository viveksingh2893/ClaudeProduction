"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderTree, Pencil, Power, ShieldCheck } from "lucide-react";
import {
  ActiveBadge,
  AdminDataTable,
  AlertBox,
  Button,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  ImageUploadField,
  RowActionMenu,
  Truncate,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import {
  createSubcategoryAction,
  updateSubcategoryAction,
  toggleSubcategoryActiveAction,
  uploadSubcategoryImageAction,
} from "./actions";
import { LicenceRequirementsModal } from "@/components/licence-requirements-modal";
import {
  NameTranslationInputs,
  EMPTY_NAME_TRANSLATIONS,
  nameTranslationsFromRows,
  nameTranslationsToPayload,
  type NameTranslationMap,
} from "@/components/name-translation-inputs";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

type Category = { id: string; name: string; isActive: boolean };
type Subcategory = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  description?: string | null;
  isActive: boolean;
  categoryId: string;
  translations?: { language: string; name: string | null }[];
  activeLicenceRequirementCount?: number;
};

export function SubcategoriesManager({
  categories,
  subcategories,
  storefrontBaseUrl,
}: {
  categories: Category[];
  subcategories: Subcategory[];
  /** See apps/dashboard/src/lib/storefront-url.ts — a Server Action reference/closure can cross into a Client Component, but a plain arrow function can't, so this arrives as a serializable string and the display-url function is built client-side from it. */
  storefrontBaseUrl?: string | null;
}) {
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [nameTranslations, setNameTranslations] = useState<NameTranslationMap>(
    EMPTY_NAME_TRANSLATIONS,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [licenceModalItem, setLicenceModalItem] = useState<Subcategory | null>(null);

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const visible = useMemo(
    () =>
      filterCategoryId
        ? subcategories.filter((s) => s.categoryId === filterCategoryId)
        : subcategories,
    [subcategories, filterCategoryId],
  );

  function resetForm() {
    setName("");
    setSlug("");
    setImageUrl("");
    setDescription("");
    setNameTranslations(EMPTY_NAME_TRANSLATIONS);
    setEditingId(null);
    setPendingId(null);
    setError(null);
  }

  function startEdit(s: Subcategory) {
    setEditingId(s.id);
    setPendingId(null);
    setName(s.name);
    setSlug(s.slug);
    setCategoryId(s.categoryId);
    setImageUrl(s.imageUrl ?? "");
    setDescription(s.description ?? "");
    setNameTranslations(nameTranslationsFromRows(s.translations));
    setError(null);
  }

  async function handleImageUpload(file: File) {
    const id = editingId ?? pendingId ?? crypto.randomUUID();
    if (!editingId && !pendingId) setPendingId(id);
    return uploadSubcategoryImageAction(id, slug || "item", file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = {
        name,
        slug,
        categoryId,
        imageUrl: imageUrl || undefined,
        description: description.trim() || undefined,
        nameTranslations: nameTranslationsToPayload(nameTranslations),
        ...(editingId ? {} : pendingId ? { id: pendingId } : {}),
      };
      const result = editingId
        ? await updateSubcategoryAction(editingId, input)
        : await createSubcategoryAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  function handleToggle(s: Subcategory) {
    setError(null);
    startTransition(async () => {
      const result = await toggleSubcategoryActiveAction(s.id, !s.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const columns: DataTableColumn<Subcategory>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (s) => s.name,
      render: (s) => <span className="font-semibold text-ink">{s.name}</span>,
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      value: (s) => categoryNameById.get(s.categoryId) ?? "",
      render: (s) => (
        <span className="text-gray-600">{categoryNameById.get(s.categoryId) ?? "—"}</span>
      ),
    },
    {
      key: "slug",
      header: "Slug",
      sortable: true,
      value: (s) => s.slug,
      render: (s) => (
        <Truncate value={s.slug} className="font-mono text-xs text-gray-600" maxWidth="180px" />
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (s) => (s.isActive ? "Active" : "Inactive"),
      render: (s) => <ActiveBadge active={s.isActive} />,
    },
    {
      key: "licences",
      header: "Selling licence required",
      value: (s) => s.activeLicenceRequirementCount ?? 0,
      render: (s) =>
        (s.activeLicenceRequirementCount ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-bold text-green-800">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{" "}
            {s.activeLicenceRequirementCount} active
          </span>
        ) : (
          <span className="text-xs text-gray-400">None</span>
        ),
    },
  ];

  function actionsFor(s: Subcategory): RowAction[] {
    return [
      {
        label: `Edit ${s.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(s),
        disabled: isPending,
      },
      {
        label: s.isActive ? `Deactivate ${s.name}` : `Activate ${s.name}`,
        icon: <Power className="h-4 w-4" aria-hidden="true" />,
        onClick: () => handleToggle(s),
        disabled: isPending,
      },
      {
        label: `Configure licences for ${s.name}`,
        icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setLicenceModalItem(s),
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {editingId ? "Edit subcategory" : "New subcategory"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect
              label="Main category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
              disabled={isPending}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.isActive ? " (inactive)" : ""}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isPending}
            />
            <FormInput
              label="Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              disabled={isPending}
            />
            <ImageUploadField
              label="Image"
              hint="Optional"
              value={imageUrl}
              onChange={setImageUrl}
              onUpload={handleImageUpload}
              onUploadingChange={setUploading}
              resolveDisplaySrc={displaySrc}
            />
            <NameTranslationInputs
              value={nameTranslations}
              onChange={setNameTranslations}
              englishName={name}
              disabled={isPending}
            />
            <div className="sm:col-span-2">
              <FormTextarea
                label="Storefront description"
                hint={`Shown below "Shop in ${name || "this subcategory"}" on the storefront page — optional`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </div>
          </div>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" loading={isPending} disabled={uploading}>
              {editingId ? "Save changes" : "Create"}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={isPending}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      <AdminDataTable
        data={visible}
        columns={columns}
        rowKey={(s) => s.id}
        renderActions={(s) => <RowActionMenu actions={actionsFor(s)} />}
        caption="Subcategory list"
        searchPlaceholder="Search subcategories…"
        filters={
          <FormSelect
            aria-label="Filter by category"
            value={filterCategoryId}
            onChange={(e) => setFilterCategoryId(e.target.value)}
            className="!w-auto"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
        }
        clearFiltersAction={
          filterCategoryId ? (
            <button
              type="button"
              onClick={() => setFilterCategoryId("")}
              className="text-xs font-semibold text-gray-600 hover:text-green-700"
            >
              Clear filter
            </button>
          ) : undefined
        }
        emptyIcon={<FolderTree className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No subcategories yet"
        emptyDescription="Create your first subcategory using the form above."
      />

      {licenceModalItem && (
        <LicenceRequirementsModal
          open={licenceModalItem !== null}
          onClose={() => {
            setLicenceModalItem(null);
            router.refresh();
          }}
          nodeType="SUBCATEGORY"
          nodeId={licenceModalItem.id}
          nodeName={licenceModalItem.name}
        />
      )}
    </div>
  );
}
