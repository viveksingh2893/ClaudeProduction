"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { getSiteSettings } from "@kisan4u/catalog";
import { Button, Card, FormInput, AlertBox } from "@kisan4u/ui";
import { saveSiteSettingsAction } from "./actions";

type Settings = Awaited<ReturnType<typeof getSiteSettings>>;
type LinkRow = { label: string; href: string };
type SocialRow = { platform: string; href: string };

function asLinkRows(value: unknown): LinkRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is LinkRow => typeof v === "object" && v !== null && "label" in v && "href" in v,
  );
}
function asSocialRows(value: unknown): SocialRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is SocialRow => typeof v === "object" && v !== null && "platform" in v && "href" in v,
  );
}

export function SiteSettingsManager({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [wishlistEnabled, setWishlistEnabled] = useState(settings.wishlistEnabled);
  const [buyNowEnabled, setBuyNowEnabled] = useState(settings.buyNowEnabled);
  const [addToCartEnabled, setAddToCartEnabled] = useState(settings.addToCartEnabled);
  const [requestSellerEnabled, setRequestSellerEnabled] = useState(settings.requestSellerEnabled);
  const [ratingDisplayThreshold, setRatingDisplayThreshold] = useState(
    String(settings.ratingDisplayThreshold),
  );
  const [defaultDeliveryBadgeText, setDefaultDeliveryBadgeText] = useState(
    settings.defaultDeliveryBadgeText ?? "",
  );
  const [footerCustomerCareNumber, setFooterCustomerCareNumber] = useState(
    settings.footerCustomerCareNumber ?? "",
  );
  const [policyLinks, setPolicyLinks] = useState<LinkRow[]>(asLinkRows(settings.footerPolicyLinks));
  const [socialLinks, setSocialLinks] = useState<SocialRow[]>(
    asSocialRows(settings.footerSocialLinks),
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveSiteSettingsAction({
        wishlistEnabled,
        buyNowEnabled,
        addToCartEnabled,
        requestSellerEnabled,
        ratingDisplayThreshold: Number(ratingDisplayThreshold),
        defaultDeliveryBadgeText: defaultDeliveryBadgeText || undefined,
        footerCustomerCareNumber: footerCustomerCareNumber || undefined,
        footerPolicyLinks: policyLinks.filter((l) => l.label && l.href),
        footerSocialLinks: socialLinks.filter((s) => s.platform && s.href),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="mb-3 text-base font-bold text-ink">Storefront feature toggles</h2>
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={wishlistEnabled}
              onChange={(e) => setWishlistEnabled(e.target.checked)}
            />
            Wishlist (heart icon on product cards)
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={buyNowEnabled}
              onChange={(e) => setBuyNowEnabled(e.target.checked)}
            />
            Buy Now button
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={addToCartEnabled}
              onChange={(e) => setAddToCartEnabled(e.target.checked)}
            />
            Add to Cart button
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={requestSellerEnabled}
              onChange={(e) => setRequestSellerEnabled(e.target.checked)}
            />
            Request Seller (dealer state-unavailable flow)
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-base font-bold text-ink">Ratings &amp; delivery badge</h2>
        <FormInput
          label="Rating display threshold"
          hint='A product&apos;s rating only shows once it has at least this many approved reviews — otherwise it shows "New" (0 reviews) or nothing.'
          type="number"
          min={0}
          value={ratingDisplayThreshold}
          onChange={(e) => setRatingDisplayThreshold(e.target.value)}
        />
        <FormInput
          label="Default delivery badge text"
          hint="Used when a product has the delivery badge enabled but no custom text of its own."
          value={defaultDeliveryBadgeText}
          onChange={(e) => setDefaultDeliveryBadgeText(e.target.value)}
          maxLength={40}
        />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-base font-bold text-ink">Footer</h2>
        <FormInput
          label="Customer care number"
          value={footerCustomerCareNumber}
          onChange={(e) => setFooterCustomerCareNumber(e.target.value)}
        />

        <div className="mt-3">
          <div className="mb-1.5 text-[12.5px] font-semibold text-gray-600">Policy links</div>
          {policyLinks.map((link, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input
                placeholder="Label"
                value={link.label}
                onChange={(e) =>
                  setPolicyLinks((rows) =>
                    rows.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)),
                  )
                }
                className="w-1/3 rounded-md border-[1.5px] border-border px-2.5 py-2 text-sm"
              />
              <input
                placeholder="/policies/terms"
                value={link.href}
                onChange={(e) =>
                  setPolicyLinks((rows) =>
                    rows.map((r, idx) => (idx === i ? { ...r, href: e.target.value } : r)),
                  )
                }
                className="flex-1 rounded-md border-[1.5px] border-border px-2.5 py-2 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPolicyLinks((rows) => rows.filter((_, idx) => idx !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPolicyLinks((rows) => [...rows, { label: "", href: "" }])}
          >
            + Add policy link
          </Button>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-[12.5px] font-semibold text-gray-600">Social links</div>
          {socialLinks.map((link, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input
                placeholder="Platform, e.g. Facebook"
                value={link.platform}
                onChange={(e) =>
                  setSocialLinks((rows) =>
                    rows.map((r, idx) => (idx === i ? { ...r, platform: e.target.value } : r)),
                  )
                }
                className="w-1/3 rounded-md border-[1.5px] border-border px-2.5 py-2 text-sm"
              />
              <input
                placeholder="https://..."
                value={link.href}
                onChange={(e) =>
                  setSocialLinks((rows) =>
                    rows.map((r, idx) => (idx === i ? { ...r, href: e.target.value } : r)),
                  )
                }
                className="flex-1 rounded-md border-[1.5px] border-border px-2.5 py-2 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSocialLinks((rows) => rows.filter((_, idx) => idx !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSocialLinks((rows) => [...rows, { platform: "", href: "" }])}
          >
            + Add social link
          </Button>
        </div>
      </Card>

      {error && <AlertBox tone="danger">{error}</AlertBox>}
      {saved && !error && <AlertBox tone="success">Saved.</AlertBox>}

      <Button type="submit" variant="primary" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
