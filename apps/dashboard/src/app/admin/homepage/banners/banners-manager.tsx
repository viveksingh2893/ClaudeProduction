"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { listPromotionalAssets } from "@kisan4u/catalog";
import { Button, AlertBox, FormInput, FormSelect } from "@kisan4u/ui";
import { savePromotionalAssetAction, deletePromotionalAssetAction } from "../actions";

type Asset = Awaited<ReturnType<typeof listPromotionalAssets>>[number];

const EMPTY = {
  id: undefined as string | undefined,
  placement: "HERO" as "HERO" | "COUPON" | "HERO_SECONDARY" | "JOIN_DEALER" | "JOIN_SELLER",
  audience: "COMMON" as "COMMON" | "CUSTOMER" | "DEALER",
  desktopImageUrl: "",
  mobileImageUrl: "",
  altText: "",
  linkUrl: "",
  ctaLabel: "",
  priority: "0",
  isActive: true,
};

const PLACEMENT_LABEL: Record<string, string> = {
  HERO: "Hero carousel slide",
  COUPON: "Coupon strip",
  JOIN_DEALER: "Join banner — Become a Dealer",
  JOIN_SELLER: "Join banner — Become a Seller",
};

export function BannersManager({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  function edit(asset: Asset) {
    setForm({
      id: asset.id,
      placement: asset.placement,
      audience: asset.audience,
      desktopImageUrl: asset.desktopImageUrl,
      mobileImageUrl: asset.mobileImageUrl ?? "",
      altText: asset.altText,
      linkUrl: asset.linkUrl ?? "",
      ctaLabel: asset.ctaLabel ?? "",
      priority: String(asset.priority),
      isActive: asset.isActive,
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await savePromotionalAssetAction({
        id: form.id,
        placement: form.placement,
        audience: form.audience,
        desktopImageUrl: form.desktopImageUrl,
        mobileImageUrl: form.mobileImageUrl || undefined,
        altText: form.altText,
        linkUrl: form.linkUrl || undefined,
        ctaLabel: form.ctaLabel || undefined,
        priority: Number(form.priority),
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

  function remove(id: string) {
    startTransition(async () => {
      await deletePromotionalAssetAction(id);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {assets.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-ink">
                {PLACEMENT_LABEL[a.placement]} · {a.audience} {!a.isActive && "· inactive"}
              </div>
              <div className="truncate text-xs text-gray-500">{a.altText} — {a.desktopImageUrl}</div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => edit(a)}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={isPending} onClick={() => remove(a.id)}>
              Delete
            </Button>
          </div>
        ))}
        {assets.length === 0 && <p className="text-sm text-gray-500">No banners yet.</p>}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-ink">{form.id ? "Edit banner" : "Add banner"}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormSelect
            label="Placement"
            value={form.placement}
            onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value as typeof form.placement }))}
          >
            <option value="HERO">Hero carousel slide</option>
            <option value="COUPON">Coupon strip</option>
            <option value="JOIN_DEALER">Join banner — Become a Dealer</option>
            <option value="JOIN_SELLER">Join banner — Become a Seller</option>
          </FormSelect>
          <FormSelect
            label="Audience"
            value={form.audience}
            onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as typeof form.audience }))}
          >
            <option value="COMMON">Common</option>
            <option value="CUSTOMER">Customer only</option>
            <option value="DEALER">Dealer only</option>
          </FormSelect>
          <FormInput
            label="Desktop image URL"
            required
            value={form.desktopImageUrl}
            onChange={(e) => setForm((f) => ({ ...f, desktopImageUrl: e.target.value }))}
          />
          <FormInput
            label="Mobile image URL (optional)"
            value={form.mobileImageUrl}
            onChange={(e) => setForm((f) => ({ ...f, mobileImageUrl: e.target.value }))}
          />
          <FormInput
            label="Alt text"
            required
            value={form.altText}
            onChange={(e) => setForm((f) => ({ ...f, altText: e.target.value }))}
          />
          <FormInput label="Link URL (optional)" value={form.linkUrl} onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))} />
          <FormInput
            label="CTA label (optional)"
            value={form.ctaLabel}
            onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
          />
          <FormInput
            label="Priority (slide order)"
            type="number"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          Active
        </label>
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={isPending}>
            {form.id ? "Save changes" : "Add banner"}
          </Button>
          {form.id && (
            <Button type="button" variant="ghost" onClick={() => setForm(EMPTY)}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
