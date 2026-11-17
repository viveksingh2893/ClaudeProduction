"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applySelection,
  getAvailableValuesForAttribute,
  getInitialSelection,
  getVariantAttributes,
  isSelectionComplete,
  resolveVariant,
  type CompatibilityVariant,
  type VariantSelection,
} from "@kisan4u/catalog/variant-compatibility";

export type PlainVariant = CompatibilityVariant & {
  sku: string;
  mrp: string;
  sellingPrice: string;
  minOrderQty: number;
  imageUrl: string | null;
  imageAlt: string | null;
  /** Additional gallery images beyond imageUrl — empty when the variant has none of its own (falls back to the product's own gallery at render time). */
  images: Array<{ id: string; url: string; altText: string | null }>;
  /** Falls back to the product's own video when null. */
  videoUrl: string | null;
  /** Reward points earned on a purchase of this variant. No points-earning logic exists yet — always 0/null today, but the field is real and displayed. */
  loyaltyPoints: number | null;
};

/**
 * The one shared attribute-button variant selector — independent
 * per-attribute selectors (Colour, Size, ... — never assumes which
 * attributes exist or how many) resolving to one real variant/SKU.
 * Incompatible values stay visible but disabled ("Unavailable") rather
 * than disappearing, per the redesign brief; picking a value that
 * invalidates an earlier one clears only that one attribute (via
 * applySelection) and explains what changed instead of resetting
 * everything.
 *
 * Deliberately has NO idea what "purchasable" means for the current
 * viewer — that's role-specific business logic (customer: price + Buy
 * Now/Add to Cart; dealer: price + Add to Cart OR "not available in your
 * state" + Request This Product), supplied by the caller via
 * `renderPurchaseArea` once a complete, valid variant is resolved. This is
 * what lets the customer and dealer product pages share the exact same
 * attribute-button selection UI/logic instead of two copies that could
 * drift apart — see apps/web/src/components/product-purchase-panel.tsx and
 * apps/web/src/app/dealer/products/[id]/page.tsx.
 */
export function VariantPicker({
  variants,
  defaultVariantId,
  onResolvedChange,
  renderPurchaseArea,
  incompleteHint,
}: {
  variants: PlainVariant[];
  defaultVariantId?: string | null;
  onResolvedChange?: (variant: PlainVariant | null) => void;
  /** Called with the fully-resolved variant once every attribute is selected and it matches exactly one active variant. */
  renderPurchaseArea: (resolved: PlainVariant) => ReactNode;
  /** Overrides the default "Select X and Y to see price and availability" hint shown while the selection is incomplete. */
  incompleteHint?: string;
}) {
  const attributes = useMemo(() => getVariantAttributes(variants), [variants]);
  const [selection, setSelection] = useState<VariantSelection>(() =>
    getInitialSelection(variants, defaultVariantId),
  );
  const [changeNote, setChangeNote] = useState<string | null>(null);

  const resolved = resolveVariant(variants, selection) as PlainVariant | null;
  const complete = isSelectionComplete(variants, selection);

  // `onResolvedChange` used to fire only from inside `pick()` (a real
  // click) — so a page that opens with a default variant already
  // selected (the normal case, via getInitialSelection above) never told
  // the caller about it, and the gallery/video kept showing the
  // product's own fallback images until the shopper happened to click an
  // option. Runs on every mount and on every actual resolution change
  // (compared by id, since `resolved` is a fresh object each render even
  // when the underlying variant hasn't changed) — never on an unrelated
  // re-render.
  useEffect(() => {
    onResolvedChange?.(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the resolved variant's identity, not the callback or the fresh-each-render `resolved` object itself
  }, [resolved?.id]);

  function pick(attributeId: string, valueId: string) {
    const result = applySelection(variants, selection, attributeId, valueId);
    setSelection(result.selection);
    if (result.clearedAttributeIds.length > 0) {
      const names = result.clearedAttributeIds
        .map((id) => attributes.find((a) => a.attributeId === id)?.attributeName)
        .filter(Boolean)
        .join(", ");
      setChangeNote(`${names} was reset because it isn't available with this selection.`);
    } else {
      setChangeNote(null);
    }
    // No need to call onResolvedChange here directly — the effect above
    // fires on its own once `selection` updates and `resolved` is
    // recomputed on the next render.
  }

  if (attributes.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {attributes.map((group) => {
        const availability = getAvailableValuesForAttribute(variants, selection, group.attributeId);
        return (
          <div key={group.attributeId} className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">
              {group.attributeName}
            </span>
            <div
              role="radiogroup"
              aria-label={group.attributeName}
              className="flex flex-wrap gap-2"
            >
              {availability.map((opt) => {
                const isSelected = selection[group.attributeId] === opt.valueId;
                // Gate on `reachable` (exists in SOME active variant, in any
                // combination), not `available` (compatible with what's
                // currently selected elsewhere) — see reachable's doc
                // comment in variant-compatibility.ts. A value that's
                // merely incompatible with the CURRENT other selections is
                // still clickable: picking it lets applySelection clear the
                // conflicting attribute instead of leaving no click path.
                const disabled = !opt.reachable;
                const label = disabled
                  ? `${opt.value}, unavailable`
                  : !opt.inStock
                    ? `${opt.value}, out of stock`
                    : opt.value;
                return (
                  <button
                    key={opt.valueId}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={label}
                    title={label}
                    disabled={disabled}
                    onClick={() => pick(group.attributeId, opt.valueId)}
                    className={`flex h-10 items-center rounded-lg border-[1.5px] px-4 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 ${
                      isSelected
                        ? "border-green-600 bg-green-50 font-semibold text-green-800"
                        : disabled
                          ? "cursor-not-allowed border-gray-200 bg-gray-50 font-medium text-gray-300 opacity-60"
                          : "border-border bg-surface font-medium text-ink hover:border-green-500"
                    }`}
                  >
                    {opt.value}
                    {!disabled && !opt.inStock && (
                      <span className="ml-1 text-[10px] font-normal text-gray-400">
                        (out of stock)
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {changeNote && (
        <p role="status" className="text-xs font-medium text-warning">
          {changeNote}
        </p>
      )}

      {complete && resolved ? (
        renderPurchaseArea(resolved)
      ) : (
        <p className="text-sm text-gray-500">
          {incompleteHint ??
            `Select ${attributes.map((a) => a.attributeName).join(" and ")} to see price and availability.`}
        </p>
      )}
    </div>
  );
}
