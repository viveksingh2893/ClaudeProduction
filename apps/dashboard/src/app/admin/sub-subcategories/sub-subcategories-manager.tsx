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
  createSubSubCategoryAction,
  updateSubSubCategoryAction,
  toggleSubSubCategoryActiveAction,
  uploadSubSubCategoryImageAction,
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

type Category = { id: string; name: string };
type Subcategory = { id: string; name: string; categoryId: string };
type SubSubCategory = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  description?: string | null;
  isActive: boolean;
  subCategoryId: string;
  translations?: { language: string; name: string | null }[];
  activeLicenceRequirementCount?: number;
};

export function SubSubCategoriesManager({
  categories,
  subcategories,
  subSubCategories,
  storefrontBaseUrl,
}: {
  categories: Category[];
  subcategories: Subcategory[];
  subSubCategories: SubSubCategory[];
  storefrontBaseUrl?: string | null;
}) {
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();

  // Form state: category picked first, purely to filter the subcategory
  // dropdown — only subCategoryId is ever sent to the server.
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id ?? "");
  const formSubcategoryOptions = useMemo(
    () => subcategories.filter((s) => s.categoryId === formCategoryId),
    [subcategories, formCategoryId],
  );
  const [subCategoryId, setSubCategoryId] = useState(formSubcategoryOptions[0]?.id ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
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
  const [licenceModalItem, setLicenceModalItem] = useState<SubSubCategory | null>(null);

  // List filter: category -> subcategory, same cascading idea.
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const filterSubcategoryOptions = useMemo(
    () =>
      filterCategoryId
        ? subcategories.filter((s) => s.categoryId === filterCategoryId)
        : subcategories,
    [subcategories, filterCategoryId],
  );
  const [filterSubCategoryId, setFilterSubCategoryId] = useState("");

  const subcategoryNameById = useMemo(
    () => new Map(subcategories.map((s) => [s.id, s.name])),
    [subcategories],
  );

  const visible = useMemo(
    () =>
      filterSubCategoryId
        ? subSubCategories.filter((x) => x.subCategoryId === filterSubCategoryId)
        : subSubCategories,
    [subSubCategories, filterSubCategoryId],
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

  function startEdit(x: SubSubCategory) {
    setEditingId(x.id);
    setPendingId(null);
    setName(x.name);
    setSlug(x.slug);
    setImageUrl(x.imageUrl ?? "");
    setDescription(x.description ?? "");
    setNameTranslations(nameTranslationsFromRows(x.translations));
    const parentSub = subcategories.find((s) => s.id === x.subCategoryId);
    if (parentSub) setFormCategoryId(parentSub.categoryId);
    setSubCategoryId(x.subCategoryId);
    setError(null);
  }

  async function handleImageUpload(file: File) {
    const id = editingId ?? pendingId ?? crypto.randomUUID();
    if (!editingId && !pendingId) setPendingId(id);
    return uploadSubSubCategoryImageAction(id, slug || "item", file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = {
        name,
        slug,
        subCategoryId,
        imageUrl: imageUrl || undefined,
        description: description.trim() || undefined,
        nameTranslations: nameTranslationsToPayload(nameTranslations),
        ...(editingId ? {} : pendingId ? { id: pendingId } : {}),
      };
      const result = editingId
        ? await updateSubSubCategoryAction(editingId, input)
        : await createSubSubCategoryAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  function handleToggle(x: SubSubCategory) {
    setError(null);
    startTransition(async () => {
      const result = await toggleSubSubCategoryActiveAction(x.id, !x.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const columns: DataTableColumn<SubSubCategory>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (x) => x.name,
      render: (x) => <span className="font-semibold text-ink">{x.name}</span>,
    },
    {
      key: "subcategory",
      header: "Subcategory",
      sortable: true,
      value: (x) => subcategoryNameById.get(x.subCategoryId) ?? "",
      render: (x) => (
        <span className="text-gray-600">{subcategoryNameById.get(x.subCategoryId) ?? "—"}</span>
      ),
    },
    {
      key: "slug",
      header: "Slug",
      sortable: true,
      value: (x) => x.slug,
      render: (x) => (
        <Truncate value={x.slug} className="font-mono text-xs text-gray-600" maxWidth="180px" />
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (x) => (x.isActive ? "Active" : "Inactive"),
      render: (x) => <ActiveBadge active={x.isActive} />,
    },
    {
      key: "licences",
      header: "Selling licence required",
      value: (x) => x.activeLicenceRequirementCount ?? 0,
      render: (x) =>
        (x.activeLicenceRequirementCount ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-bold text-green-800">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{" "}
            {x.activeLicenceRequirementCount} active
          </span>
        ) : (
          <span className="text-xs text-gray-400">None</span>
        ),
    },
  ];

  function actionsFor(x: SubSubCategory): RowAction[] {
    return [
      {
        label: `Edit ${x.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(x),
        disabled: isPending,
      },
      {
        label: x.isActive ? `Deactivate ${x.name}` : `Activate ${x.name}`,
        icon: <Power className="h-4 w-4" aria-hidden="true" />,
        onClick: () => handleToggle(x),
        disabled: isPending,
      },
      {
        label: `Configure licences for ${x.name}`,
        icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
        onClick: () => setLicenceModalItem(x),
      },
    ];
  }

  const hasActiveFilter = !!filterCategoryId || !!filterSubCategoryId;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {editingId ? "Edit sub-subcategory" : "New sub-subcategory"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect
              label="Category"
              value={formCategoryId}
              onChange={(e) => {
                setFormCategoryId(e.target.value);
                const firstMatch = subcategories.find((s) => s.categoryId === e.target.value);
                setSubCategoryId(firstMatch?.id ?? "");
              }}
              disabled={isPending}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Subcategory"
              value={subCategoryId}
              onChange={(e) => setSubCategoryId(e.target.value)}
              required
              disabled={isPending}
            >
              {formSubcategoryOptions.length === 0 && (
                <option value="">No subcategories under this category</option>
              )}
              {formSubcategoryOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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
            <div className="sm:col-span-2">
              <ImageUploadField
                label="Image"
                hint="Optional"
                value={imageUrl}
                onChange={setImageUrl}
                onUpload={handleImageUpload}
                onUploadingChange={setUploading}
                resolveDisplaySrc={displaySrc}
              />
            </div>
            <NameTranslationInputs
              value={nameTranslations}
              onChange={setNameTranslations}
              englishName={name}
              disabled={isPending}
            />
            <div className="sm:col-span-2">
              <FormTextarea
                label="Storefront description"
                hint={`Shown below "Shop in ${name || "this sub-subcategory"}" on the storefront page — optional`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </div>
          </div>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" loading={isPending} disabled={!subCategoryId || uploading}>
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
        rowKey={(x) => x.id}
        renderActions={(x) => <RowActionMenu actions={actionsFor(x)} />}
        caption="Sub-subcategory list"
        searchPlaceholder="Search sub-subcategories…"
        filters={
          <>
            <FormSelect
              aria-label="Filter by category"
              value={filterCategoryId}
              onChange={(e) => {
                setFilterCategoryId(e.target.value);
                setFilterSubCategoryId("");
              }}
              className="!w-auto"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              aria-label="Filter by subcategory"
              value={filterSubCategoryId}
              onChange={(e) => setFilterSubCategoryId(e.target.value)}
              className="!w-auto"
            >
              <option value="">All subcategories</option>
              {filterSubcategoryOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </FormSelect>
          </>
        }
        clearFiltersAction={
          hasActiveFilter ? (
            <button
              type="button"
              onClick={() => {
                setFilterCategoryId("");
                setFilterSubCategoryId("");
              }}
              className="text-xs font-semibold text-gray-600 hover:text-green-700"
            >
              Clear filters
            </button>
          ) : undefined
        }
        emptyIcon={<FolderTree className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No sub-subcategories yet"
        emptyDescription="Create your first sub-subcategory using the form above."
      />

      {licenceModalItem && (
        <LicenceRequirementsModal
          open={licenceModalItem !== null}
          onClose={() => {
            setLicenceModalItem(null);
            router.refresh();
          }}
          nodeType="SUBSUBCATEGORY"
          nodeId={licenceModalItem.id}
          nodeName={licenceModalItem.name}
        />
      )}
    </div>
  );
}
