"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Pencil, Power, ShieldCheck } from "lucide-react";
import {
  ActiveBadge,
  AdminDataTable,
  AlertBox,
  Button,
  Card,
  FormInput,
  FormTextarea,
  IdentityCell,
  ImageUploadField,
  RowActionMenu,
  Truncate,
  type DataTableColumn,
  type ImageUploadResult,
  type RowAction,
} from "@kisan4u/ui";
import type { CategoryNameTranslationInput } from "@kisan4u/validators";
import { LicenceRequirementsModal } from "./licence-requirements-modal";
import {
  NameTranslationInputs,
  EMPTY_NAME_TRANSLATIONS,
  nameTranslationsFromRows,
  nameTranslationsToPayload,
  type NameTranslationMap,
} from "./name-translation-inputs";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

export type MasterDataItem = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  imageUrl?: string | null;
  /** A single emoji — only meaningful when hasEmoji is set (top-level Category). */
  emoji?: string | null;
  /** Per-language name overrides — only meaningful when hasNameTranslations is set. */
  translations?: { language: string; name: string | null }[];
  /** Storefront-page descriptive copy, shown below the "Shop in {name}" heading. */
  description?: string | null;
  /** 1-based "Shop by Category" display rank among active items — only meaningful when hasHomepagePosition is set and the item is active. */
  homepagePosition?: number;
  /** Count of currently active direct LicenceRequirement rows — only meaningful when showLicenceConfig is set (see /admin/categories/page.tsx). */
  activeLicenceRequirementCount?: number;
};

type MutationResult = { ok: true } | { ok: false; error: string };

/**
 * Shared create/edit/search/activate-toggle UI for the simple "name + slug
 * (+ optional image) + isActive" master-data resources (ProductAttribute,
 * and previously Brand/Manufacturer before their status/ownership
 * workflow — see brand-manufacturer-manager.tsx) — every simple
 * master-data page needs the same four operations, so this is the one
 * place that logic lives instead of five near-identical page components.
 * Category/Subcategory/SubSubCategory get their own pages instead: their
 * parent-selection dropdowns are genuinely different per level, not a
 * good fit for this shared shape.
 */
export function MasterDataManager({
  label,
  items,
  hasImage = false,
  hasEmoji = false,
  emojiOptionalWithImage = false,
  imageHint,
  hasNameTranslations = false,
  hasHomepagePosition = false,
  showLicenceConfig = false,
  onCreate,
  onUpdate,
  onToggleActive,
  onSetHomepagePosition,
  onUploadImage,
  storefrontBaseUrl,
}: {
  label: string;
  items: MasterDataItem[];
  hasImage?: boolean;
  /** Shows a required "Emoji" field + column — only meaningful for top-level Category. */
  hasEmoji?: boolean;
  /** Crops / pests: the uploaded image replaces the emoji on the storefront, so the emoji is only required while there's no image. */
  emojiOptionalWithImage?: boolean;
  /** Overrides the image field's "Optional" hint. */
  imageHint?: string;
  /** Shows the HI/MR/TE/TA "Name in other languages" block — for the category hierarchy. */
  hasNameTranslations?: boolean;
  /** Shows a "Shop by Category" position dropdown per active row — only meaningful for top-level Category (see /admin/categories/page.tsx). */
  hasHomepagePosition?: boolean;
  /** Selling-licence module — shows a "Licences" column + "Configure licences" row action, treating this resource's items as CATEGORY-level taxonomy nodes. Only meaningful for /admin/categories. */
  showLicenceConfig?: boolean;
  onCreate: (input: {
    name: string;
    slug: string;
    imageUrl?: string;
    emoji?: string;
    description?: string;
    nameTranslations?: CategoryNameTranslationInput[];
    id?: string;
  }) => Promise<MutationResult>;
  onUpdate: (
    id: string,
    input: {
      name: string;
      slug: string;
      imageUrl?: string;
      emoji?: string;
      description?: string;
      nameTranslations?: CategoryNameTranslationInput[];
    },
  ) => Promise<MutationResult>;
  onToggleActive: (id: string, isActive: boolean) => Promise<MutationResult>;
  onSetHomepagePosition?: (id: string, position: number) => Promise<MutationResult>;
  /** Only required when hasImage is set — see uploadCategoryImageAction's doc comment for the client-minted-id create flow this powers. */
  onUploadImage?: (id: string, slug: string, file: File) => Promise<ImageUploadResult>;
  storefrontBaseUrl?: string | null;
}) {
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [emoji, setEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [nameTranslations, setNameTranslations] = useState<NameTranslationMap>(
    EMPTY_NAME_TRANSLATIONS,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  // Minted the first time an image is uploaded while creating a brand-new
  // item (no real id exists yet) — reused as this row's actual primary
  // key on create, so the folder the image was already uploaded to is
  // correct from the start. Cleared on reset/edit; irrelevant once
  // editingId is set (edits always upload straight to the real id).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [licenceModalItem, setLicenceModalItem] = useState<MasterDataItem | null>(null);
  const activeCount = hasHomepagePosition ? items.filter((i) => i.isActive).length : 0;

  function handleSetPosition(item: MasterDataItem, position: number) {
    if (!onSetHomepagePosition) return;
    setError(null);
    startTransition(async () => {
      const result = await onSetHomepagePosition(item.id, position);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function resetForm() {
    setName("");
    setSlug("");
    setImageUrl("");
    setEmoji("");
    setDescription("");
    setNameTranslations(EMPTY_NAME_TRANSLATIONS);
    setEditingId(null);
    setPendingId(null);
    setError(null);
  }

  function startEdit(item: MasterDataItem) {
    setEditingId(item.id);
    setPendingId(null);
    setName(item.name);
    setSlug(item.slug);
    setImageUrl(item.imageUrl ?? "");
    setEmoji(item.emoji ?? "");
    setDescription(item.description ?? "");
    setNameTranslations(nameTranslationsFromRows(item.translations));
    setError(null);
  }

  async function handleImageUpload(file: File): Promise<ImageUploadResult> {
    if (!onUploadImage) return { ok: false, error: "Upload is not available here." };
    const id = editingId ?? pendingId ?? crypto.randomUUID();
    if (!editingId && !pendingId) setPendingId(id);
    return onUploadImage(id, slug || "item", file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (hasEmoji && !emoji.trim() && !(emojiOptionalWithImage && imageUrl)) {
        setError(
          emojiOptionalWithImage
            ? "Add an image (or an emoji until the image is ready)."
            : "An emoji is required for a category.",
        );
        return;
      }
      const input = {
        name,
        slug,
        imageUrl: imageUrl || undefined,
        description: description.trim() || undefined,
        ...(hasEmoji ? { emoji: emoji.trim() } : {}),
        ...(hasNameTranslations
          ? { nameTranslations: nameTranslationsToPayload(nameTranslations) }
          : {}),
        ...(editingId ? {} : pendingId ? { id: pendingId } : {}),
      };
      const result = editingId ? await onUpdate(editingId, input) : await onCreate(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  function handleToggle(item: MasterDataItem) {
    setError(null);
    startTransition(async () => {
      const result = await onToggleActive(item.id, !item.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const columns: DataTableColumn<MasterDataItem>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (item) => item.name,
      render: (item) =>
        hasImage ? (
          <IdentityCell
            name={item.name}
            avatarUrl={item.imageUrl ? displaySrc(item.imageUrl) : item.imageUrl}
          />
        ) : (
          <span className="font-semibold text-ink">{item.name}</span>
        ),
    },
    ...(hasEmoji
      ? [
          {
            key: "emoji",
            header: "Emoji",
            value: (item: MasterDataItem) => item.emoji ?? "",
            render: (item: MasterDataItem) => (
              <span className="text-lg">{item.emoji ?? "—"}</span>
            ),
          } satisfies DataTableColumn<MasterDataItem>,
        ]
      : []),
    {
      key: "slug",
      header: "Slug",
      sortable: true,
      value: (item) => item.slug,
      render: (item) => (
        <Truncate value={item.slug} className="font-mono text-xs text-gray-600" maxWidth="180px" />
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (item) => (item.isActive ? "Active" : "Inactive"),
      render: (item) => <ActiveBadge active={item.isActive} />,
    },
    ...(showLicenceConfig
      ? [
          {
            key: "licences",
            header: "Selling licence required",
            value: (item: MasterDataItem) => item.activeLicenceRequirementCount ?? 0,
            render: (item: MasterDataItem) =>
              (item.activeLicenceRequirementCount ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-bold text-green-800">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                  {item.activeLicenceRequirementCount} active
                </span>
              ) : (
                <span className="text-xs text-gray-400">None</span>
              ),
          } satisfies DataTableColumn<MasterDataItem>,
        ]
      : []),
    ...(hasHomepagePosition
      ? [
          {
            key: "homepagePosition",
            header: "Shop by category position",
            value: (item: MasterDataItem) => item.homepagePosition ?? 0,
            render: (item: MasterDataItem) =>
              item.isActive ? (
                <select
                  value={item.homepagePosition ?? 1}
                  disabled={isPending}
                  onChange={(e) => handleSetPosition(item, Number(e.target.value))}
                  aria-label={`${item.name} homepage position`}
                  className="rounded-md border-[1.5px] border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-green-600"
                >
                  {Array.from({ length: activeCount }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-gray-400">Not shown (inactive)</span>
              ),
          } satisfies DataTableColumn<MasterDataItem>,
        ]
      : []),
  ];

  function actionsFor(item: MasterDataItem): RowAction[] {
    return [
      {
        label: `Edit ${item.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(item),
        disabled: isPending,
      },
      {
        label: item.isActive ? `Deactivate ${item.name}` : `Activate ${item.name}`,
        icon: <Power className="h-4 w-4" aria-hidden="true" />,
        onClick: () => handleToggle(item),
        disabled: isPending,
      },
      ...(showLicenceConfig
        ? [
            {
              label: `Configure licences for ${item.name}`,
              icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
              onClick: () => setLicenceModalItem(item),
            },
          ]
        : []),
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {editingId ? `Edit ${label}` : `New ${label}`}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
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
            {hasEmoji && (
              <FormInput
                label="Emoji"
                hint={
                  emojiOptionalWithImage
                    ? "Shown on the storefront only until an image is uploaded"
                    : "A single emoji shown in the storefront category ribbon"
                }
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                required={!emojiOptionalWithImage}
                maxLength={8}
                placeholder="🌱"
                disabled={isPending}
              />
            )}
            <div className="sm:col-span-2">
              <FormTextarea
                label="Storefront description"
                hint={`Shown below "Shop in ${name || label}" on the storefront page — optional`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </div>
            {hasImage && onUploadImage && (
              <div className="sm:col-span-2">
                <ImageUploadField
                  label="Image"
                  hint={imageHint ?? "Optional"}
                  value={imageUrl}
                  onChange={setImageUrl}
                  onUpload={handleImageUpload}
                  onUploadingChange={setUploading}
                  resolveDisplaySrc={displaySrc}
                />
              </div>
            )}
            {hasNameTranslations && (
              <NameTranslationInputs
                value={nameTranslations}
                onChange={setNameTranslations}
                englishName={name}
                disabled={isPending}
              />
            )}
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
        data={items}
        columns={columns}
        rowKey={(item) => item.id}
        renderActions={(item) => <RowActionMenu actions={actionsFor(item)} />}
        caption={`${label} list`}
        searchPlaceholder={`Search ${label.toLowerCase()}s…`}
        emptyIcon={<Layers className="h-8 w-8" aria-hidden="true" />}
        emptyTitle={`No ${label.toLowerCase()}s yet`}
        emptyDescription={`Create your first ${label.toLowerCase()} using the form above.`}
      />

      {showLicenceConfig && licenceModalItem && (
        <LicenceRequirementsModal
          open={licenceModalItem !== null}
          onClose={() => {
            setLicenceModalItem(null);
            router.refresh();
          }}
          nodeType="CATEGORY"
          nodeId={licenceModalItem.id}
          nodeName={licenceModalItem.name}
        />
      )}
    </div>
  );
}
