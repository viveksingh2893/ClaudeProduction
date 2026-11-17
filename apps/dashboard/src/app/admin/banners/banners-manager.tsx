"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, Trash2 } from "lucide-react";
import type { listPromotionalAssets } from "@kisan4u/catalog";
import {
  Badge,
  Button,
  AlertBox,
  ConfirmDialog,
  FormInput,
  FormSelect,
  ImageUploadField,
  RecordList,
  RecordListRow,
  RowActionMenu,
  Thumbnail,
  type RowAction,
} from "@kisan4u/ui";
import { languageMeta, type DbLanguage } from "@kisan4u/validators";
import { saveBannerAction, deleteBannerAction, uploadBannerImageAction } from "./actions";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

type Banner = Awaited<ReturnType<typeof listPromotionalAssets>>[number];
type BannerAudience = "CUSTOMER" | "DEALER" | "COMMON";

const AUDIENCE_LABEL: Record<BannerAudience, string> = {
  CUSTOMER: "Customer",
  DEALER: "Dealer",
  COMMON: "Both",
};
const AUDIENCE_TONE: Record<BannerAudience, "info" | "warning" | "neutral"> = {
  CUSTOMER: "info",
  DEALER: "warning",
  COMMON: "neutral",
};

function emptyForm(audience: BannerAudience, language: DbLanguage) {
  return {
    id: undefined as string | undefined,
    audience,
    language,
    categoryId: "",
    desktopImageUrl: "",
    mobileImageUrl: "",
    altText: "",
    linkUrl: "",
    priority: "0",
    isActive: true,
  };
}

export function BannersManager({
  banners,
  placement,
  audience,
  language,
  categories,
  storefrontBaseUrl,
}: {
  banners: Banner[];
  placement: "HERO" | "COUPON" | "HERO_SECONDARY";
  /** The audience currently selected in the page's toggle — used as the audience for any NEW banner created here. */
  audience: "CUSTOMER" | "DEALER";
  /** The language currently selected in the page's toggle — used as the language for any NEW banner created here. */
  language: DbLanguage;
  /** Active categories for the "Belongs to" target dropdown (Home page = null). */
  categories: { id: string; name: string }[];
  storefrontBaseUrl?: string | null;
}) {
  const categoryName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "Unknown category") : "Home page";
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => emptyForm(audience, language));
  const [uploading, setUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sorted = [...banners].sort((a, b) => a.priority - b.priority);

  function edit(banner: Banner) {
    setError(null);
    setForm({
      id: banner.id,
      // Preserve the banner's OWN audience + language on edit (e.g. a shared
      // "Both" banner stays shared, a Hindi banner stays Hindi) — the toggles
      // only decide these for banners created fresh, never silently reassign
      // an existing one.
      audience: banner.audience,
      language: banner.language,
      categoryId: banner.categoryId ?? "",
      desktopImageUrl: banner.desktopImageUrl,
      mobileImageUrl: banner.mobileImageUrl ?? "",
      altText: banner.altText,
      linkUrl: banner.linkUrl ?? "",
      priority: String(banner.priority),
      isActive: banner.isActive,
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveBannerAction(placement, form.audience, form.language, {
        id: form.id,
        categoryId: form.categoryId || undefined,
        desktopImageUrl: form.desktopImageUrl,
        mobileImageUrl: form.mobileImageUrl || undefined,
        altText: form.altText,
        linkUrl: form.linkUrl || undefined,
        priority: form.priority,
        isActive: form.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(emptyForm(audience, language));
      router.refresh();
    });
  }

  function toggleActive(banner: Banner) {
    startTransition(async () => {
      await saveBannerAction(placement, banner.audience, banner.language, {
        id: banner.id,
        categoryId: banner.categoryId ?? undefined,
        desktopImageUrl: banner.desktopImageUrl,
        mobileImageUrl: banner.mobileImageUrl ?? undefined,
        altText: banner.altText,
        linkUrl: banner.linkUrl ?? undefined,
        priority: banner.priority,
        isActive: !banner.isActive,
      });
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    startTransition(async () => {
      await deleteBannerAction(placement, id);
      setPendingDeleteId(null);
      if (form.id === id) setForm(emptyForm(audience, language));
      router.refresh();
    });
  }

  function actionsFor(banner: Banner): RowAction[] {
    return [
      {
        label: `Edit ${banner.altText}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => edit(banner),
        disabled: isPending,
      },
      {
        label: banner.isActive ? `Deactivate ${banner.altText}` : `Activate ${banner.altText}`,
        icon: <Power className="h-4 w-4" aria-hidden="true" />,
        onClick: () => toggleActive(banner),
        disabled: isPending,
      },
      {
        label: `Delete ${banner.altText}`,
        icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setPendingDeleteId(banner.id),
        disabled: isPending,
      },
    ];
  }

  const pendingDeleteBanner = pendingDeleteId
    ? sorted.find((b) => b.id === pendingDeleteId)
    : undefined;
  const label =
    placement === "COUPON" ? "coupon banner" : placement === "HERO_SECONDARY" ? "second banner" : "hero banner";

  return (
    <div className="flex flex-col gap-6">
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500">No {label}s yet — add one below.</p>
      ) : (
        <RecordList>
          {sorted.map((banner) => (
            <RecordListRow key={banner.id}>
              <Thumbnail src={displaySrc(banner.desktopImageUrl)} alt="" size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-bold text-ink">
                  {banner.altText}
                  <Badge tone={banner.isActive ? "success" : "neutral"}>
                    {banner.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Badge tone={AUDIENCE_TONE[banner.audience]}>
                    {AUDIENCE_LABEL[banner.audience]}
                  </Badge>
                  <Badge tone="neutral">{languageMeta(banner.language).label}</Badge>
                  <Badge tone="neutral">{categoryName(banner.categoryId)}</Badge>
                </div>
                <div className="truncate text-xs text-gray-500">
                  Order {banner.priority}{" "}
                  {banner.linkUrl ? `· links to ${banner.linkUrl}` : "· no destination link"}
                </div>
              </div>
              <RowActionMenu actions={actionsFor(banner)} />
            </RecordListRow>
          ))}
        </RecordList>
      )}

      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-ink">
            {form.id ? `Edit ${label}` : `Add ${label}`}
          </h2>
          <Badge tone={AUDIENCE_TONE[form.audience]}>
            {form.id
              ? `For ${AUDIENCE_LABEL[form.audience]}`
              : `Will be created for ${AUDIENCE_LABEL[form.audience]}`}
          </Badge>
          <Badge tone="neutral">{languageMeta(form.language).label}</Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ImageUploadField
            label="Desktop image"
            required
            hint="Upload a JPEG/PNG/WEBP (wide, ~16:5), or paste an image URL."
            value={form.desktopImageUrl}
            onChange={(url) => setForm((f) => ({ ...f, desktopImageUrl: url }))}
            onUpload={uploadBannerImageAction}
            onUploadingChange={setUploading}
            resolveDisplaySrc={displaySrc}
          />
          <ImageUploadField
            label="Mobile image (optional)"
            hint="Taller crop for phones. Falls back to the desktop image when left blank."
            value={form.mobileImageUrl}
            onChange={(url) => setForm((f) => ({ ...f, mobileImageUrl: url }))}
            onUpload={uploadBannerImageAction}
            onUploadingChange={setUploading}
            resolveDisplaySrc={displaySrc}
          />
          <FormInput
            label="Alt text"
            required
            hint="Describes the banner for screen readers."
            value={form.altText}
            onChange={(e) => setForm((f) => ({ ...f, altText: e.target.value }))}
          />
          <FormInput
            label="Destination link (optional)"
            hint="Relative path (/products) or a full https:// URL."
            value={form.linkUrl}
            onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
          />
          <FormInput
            label="Display order"
            required
            type="number"
            min={0}
            step={1}
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
          />
          <FormSelect
            label="Belongs to"
            hint="Home page, or a category's own page"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          >
            <option value="">Home page / All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
        </div>

        {form.desktopImageUrl && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-gray-600">Preview</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displaySrc(form.mobileImageUrl || form.desktopImageUrl)}
              alt=""
              className="aspect-[21/9] w-full max-w-md rounded-lg border border-border object-cover sm:max-w-lg"
            />
          </div>
        )}

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
          <Button type="submit" variant="primary" disabled={isPending || uploading}>
            {uploading ? "Uploading…" : form.id ? "Save changes" : "Add banner"}
          </Button>
          {form.id && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setForm(emptyForm(audience, language))}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={confirmDelete}
        title={
          pendingDeleteBanner ? `Delete "${pendingDeleteBanner.altText}"?` : "Delete this banner?"
        }
        description="This removes it from the homepage carousel immediately. This can't be undone."
        confirmLabel="Delete banner"
        isPending={isPending}
      />
    </div>
  );
}
