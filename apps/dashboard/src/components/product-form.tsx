"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProductSubmissionRawInput,
  DiscountTypeInput,
  ShippingConfigInput,
  NetPayableRateParams,
  NetPayableUnitParams,
} from "@kisan4u/validators";
import {
  generateCombinations,
  combinationKeyFromRefs,
  calculateSellingPrice,
  matchShippingSlab,
  normalizeAudienceSku,
  isRichTextEmpty,
  deriveSellingPriceFromNetPayable,
  maxNetPayableForMrp,
  LANGUAGES,
  languageMeta,
  type AudienceSkuAudience,
} from "@kisan4u/validators";
import { computeUnitPrice } from "@kisan4u/catalog/variant-compatibility";
import {
  AlertBox,
  Button,
  Card,
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  ImageUploadField,
  type ImageUploadResult,
} from "@kisan4u/ui";
// Deliberately a subpath import, not the "@kisan4u/ui" barrel — see that
// package's index.tsx comment: pulling Tiptap through the barrel would
// bloat every page's bundle, not just this form's.
import { RichTextEditor } from "@kisan4u/ui/RichTextEditor";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Plus, Star, Trash2 } from "lucide-react";
import type { SellingLicenceEligibilityResult } from "@kisan4u/catalog";
import { LicenceStatesSelector } from "./licence-states-selector";
import { LanguageTabs } from "./language-tabs";
import { getProductLicenceEligibilityAction } from "@/lib/licence-eligibility-action";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

export type ConfigState = {
  // Sellable-unit SKU/HSN for this audience config — see
  // normalizeAudienceSku in @kisan4u/validators for the "-cus"/"-dea"
  // suffix rule this SKU is validated/normalized against on save.
  sku: string;
  hsnCode: string;
  mrp: string;
  discountType: DiscountTypeInput;
  discountValue: string;
  /**
   * Only ever read/written by the "Display on product card" section (see
   * that FormSection below) — the discount-based Pricing & discounts
   * section (a non-variant product) never touches this field. Mirrors
   * VariantRow.sellingPrice's exact same doc comment/pattern: a plain
   * "sell this at ₹X" price the seller types, converted to
   * discountType/discountValue at submit time (variantBaseConfig's
   * sellingPriceToDiscount call) — the schema/DB representation never
   * changes, only how this one field is edited for a variant product.
   */
  sellingPrice: string;
  /**
   * "Net payable" price-mode input for this config — the amount the seller
   * wants to net per unit after settlement deductions. Only read when the
   * form's priceEntryMode is NET_PAYABLE; the selling price / discount is
   * then back-solved from it (see @kisan4u/validators net-payable.ts) both
   * for the live preview here and authoritatively on the server.
   */
  netPayableAmount: string;
  minOrderQty: string;
  currentStock: string;
  minStockQty: string;
  reorderLevel: string;
  /** Dealer-only earning scheme (see packages/orders/src/loyalty-points.ts) — settable for both audiences for display symmetry, but only ever paid out on a DEALER order. Only meaningful for a non-variant product; a variant product sets this per variant instead (VariantRow.loyaltyPoints). */
  loyaltyPoints: string;
  height: string;
  breadth: string;
  length: string;
  // Whole grams — see the "g" suffix in ShippingFields/VariantsEditor.
  weight: string;
  shippingCalcMode: "INCLUDE_WITH_PRODUCT" | "EXCLUDE_WITH_PRODUCT";
  /** Whether the tax rate (taxPercent) is already baked into `sellingPrice`, or added on top — see the Prisma TaxCalcMode enum's doc comment. Defaults to "included with tax" for every product; editable per audience. */
  taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
};

const EMPTY_CONFIG: ConfigState = {
  sku: "",
  hsnCode: "",
  mrp: "",
  discountType: "NONE",
  discountValue: "0",
  sellingPrice: "",
  netPayableAmount: "",
  minOrderQty: "1",
  currentStock: "0",
  minStockQty: "5",
  reorderLevel: "10",
  loyaltyPoints: "0",
  height: "",
  breadth: "",
  length: "",
  weight: "",
  shippingCalcMode: "INCLUDE_WITH_PRODUCT",
  taxCalcMode: "INCLUDE_WITH_PRICE",
};

/** Shared row-density input class — matches packages/ui/src/Form.tsx's FormInput styling, used directly (no label) inside the compact repeating-row editors below (attribute values, variant rows, images) where a label per cell would be noisy. */
const rowFieldClass =
  "w-full rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-green-600 placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-bg-dashboard";

/** See FormInput's identical guard (packages/ui/src/Form.tsx) — a number input must not silently change value on page-scroll. For the raw `type="number"` inputs below (row-density editor, no FormInput wrapper). */
function blurNumberInputOnWheel(e: React.WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur();
}

function CheckboxField({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-2 text-[13px] text-ink ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-green-600"
      />
      {children}
    </label>
  );
}

/**
 * Homepage redesign, phase B — the Crop and Pest & Disease pickers in the
 * classification section. A dropdown multi-select: a trigger button shows
 * the current selection ("All crops", "5 selected", …); opening it reveals
 * a searchable checkbox list with Select all / Clear all. Merchandising
 * tags only — an empty selection is always valid.
 */
function TagMultiSelect({
  label,
  hint,
  emptyHint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  emptyHint: string;
  options: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = new Set(value);
  const allSelected = options.length > 0 && value.length === options.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;

  const lower = label.toLowerCase();
  const summary =
    value.length === 0
      ? `Select ${lower}`
      : allSelected
        ? `All ${lower} (${options.length})`
        : `${value.length} selected`;

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="flex flex-col gap-1.5" ref={ref}>
      <h3 className="text-[13px] font-bold text-ink">{label}</h3>
      {hint && <p className="text-[12px] text-gray-500">{hint}</p>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={options.length === 0}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-ink disabled:opacity-60"
        >
          <span className={value.length === 0 && options.length > 0 ? "text-gray-400" : ""}>
            {options.length === 0 ? emptyHint : summary}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>

        {open && options.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            <div className="border-b border-border p-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${lower}…`}
                className="w-full rounded-md border border-border px-2 py-1 text-[13px]"
              />
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
              <button
                type="button"
                className="text-[12px] font-bold text-green-700 hover:underline"
                onClick={() => onChange(options.map((o) => o.id))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[12px] font-semibold text-gray-500 hover:underline"
                onClick={() => onChange([])}
              >
                Clear all
              </button>
            </div>
            <div className="max-h-[220px] overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-2 text-[13px] text-gray-400">No matches</p>
              ) : (
                filtered.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-ink hover:bg-bg-dashboard"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="h-4 w-4 shrink-0 rounded border-border accent-green-600"
                    />
                    {o.name}
                  </label>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only shipping-cost preview — the exact same pure matcher the
 * server uses (see packages/catalog/src/product-submission.ts) applied
 * to the active logistics config passed down via ReferenceData, so what
 * the seller sees while typing a weight always matches what the server
 * will calculate on save. This is a PREVIEW only: the server always
 * recomputes from its own fresh copy of the config, never trusts
 * anything computed here.
 */
function ShippingCostPreview({
  weight,
  logisticsConfig,
}: {
  weight: string;
  logisticsConfig: ShippingConfigInput | null;
}) {
  const weightGrams = Number(weight);
  if (!weight || !Number.isFinite(weightGrams) || weightGrams <= 0) {
    return <p className="text-[13px] text-gray-500">Enter a weight to calculate shipping cost.</p>;
  }
  const result = matchShippingSlab(weightGrams, logisticsConfig);
  if (!result.ok) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {result.error}
      </p>
    );
  }
  return (
    <p className="text-[13px] text-gray-500">
      Shipping cost (calculated): <strong className="text-ink">₹{result.price.toFixed(2)}</strong>
    </p>
  );
}

export type PriceEntryMode = "SELLING_PRICE" | "NET_PAYABLE";
export type UnitAudience = "customer" | "dealer";

export type DerivedNetPayable = {
  /** true once MRP, net payable and weight are all present. */
  ready: boolean;
  sellingPrice: number;
  /** What that selling price actually nets (== the target when `exact`). */
  netPayable: number;
  exact: boolean;
  /** Net payable at which the selling price would equal MRP — the "bar" ceiling. */
  maxNetPayable: number;
  /** Derived selling price is above MRP (or non-positive) — a hard error. */
  overMrp: boolean;
};

/**
 * Client-side twin of the server's authoritative conversion (see
 * @kisan4u/orders applyNetPayablePricing) — same pure @kisan4u/validators
 * helpers, same rates handed down via ReferenceData.settlementPricing, so
 * the previewed selling price matches what save will store. Returns null
 * when settlement rates aren't available at all (preview simply hidden).
 */
function deriveNetPayable(args: {
  mrp: number;
  weightGrams: number;
  netPayable: number;
  taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
  taxPercent: number;
  rates: NetPayableRateParams | null;
  logisticsConfig: ShippingConfigInput | null;
}): DerivedNetPayable | null {
  const { mrp, weightGrams, netPayable, taxCalcMode, taxPercent, rates, logisticsConfig } = args;
  if (!rates) return null;
  if (!(mrp > 0) || !(netPayable > 0) || !(weightGrams > 0)) {
    return {
      ready: false,
      sellingPrice: 0,
      netPayable: 0,
      exact: false,
      maxNetPayable: 0,
      overMrp: false,
    };
  }
  const slab = matchShippingSlab(weightGrams, logisticsConfig);
  const unitParams: NetPayableUnitParams = {
    ...rates,
    gstRatePercent: taxPercent,
    taxCalcMode,
    logisticsCharge: slab.ok ? slab.price : 0,
  };
  const derived = deriveSellingPriceFromNetPayable(netPayable, unitParams);
  return {
    ready: true,
    sellingPrice: derived.sellingPrice,
    netPayable: derived.netPayable,
    exact: derived.exact,
    maxNetPayable: maxNetPayableForMrp(mrp, unitParams),
    overMrp: derived.sellingPrice <= 0 || derived.sellingPrice > mrp + 0.005,
  };
}

/** Horizontal bar: the entered net payable against the ceiling at which the derived selling price would hit MRP. Turns red past the ceiling. */
function NetPayableBar({ value, ceiling }: { value: number; ceiling: number }) {
  if (!(ceiling > 0)) return null;
  const over = value > ceiling + 0.005;
  const pct = over ? 100 : Math.max(2, Math.min(100, (value / ceiling) * 100));
  return (
    <div className="mt-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${over ? "bg-danger" : "bg-green-600"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`mt-0.5 text-[11px] ${over ? "font-medium text-danger" : "text-gray-500"}`}>
        Max net payable (selling price = MRP): ₹{ceiling.toFixed(2)}
        {over && " — bring the net payable down to at most this"}
      </p>
    </div>
  );
}

export type NetPayableSummaryRow = {
  label: string;
  audience: "Customer" | "Dealer";
  /** false for a deactivated variant row — shown in the table but never blocks submission. */
  active: boolean;
  netPayable: number;
  mrp: number;
  derived: DerivedNetPayable | null;
};

/** Bottom-of-section recap: every sellable unit's back-solved selling price, its MRP, the max net payable that keeps it at/under MRP, and an OK / "reduce it" status. */
function NetPayableSummary({ rows }: { rows: NetPayableSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="bg-bg-dashboard text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Unit</th>
            <th className="px-3 py-2 font-semibold">Audience</th>
            <th className="px-3 py-2 text-right font-semibold">Net payable</th>
            <th className="px-3 py-2 text-right font-semibold">Selling price</th>
            <th className="px-3 py-2 text-right font-semibold">MRP</th>
            <th className="px-3 py-2 text-right font-semibold">Max net payable</th>
            <th className="px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const d = row.derived;
            const status = !d || !d.ready ? "—" : d.overMrp ? "over" : "ok";
            return (
              <tr key={i} className={`border-t border-border ${row.active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2">{row.label}</td>
                <td className="px-3 py-2">{row.audience}</td>
                <td className="px-3 py-2 text-right">
                  {row.netPayable > 0 ? `₹${row.netPayable.toFixed(2)}` : "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right ${status === "over" ? "font-semibold text-danger" : ""}`}
                >
                  {d?.ready ? `₹${d.sellingPrice.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.mrp > 0 ? `₹${row.mrp.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {d?.ready ? `₹${d.maxNetPayable.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2">
                  {status === "ok" ? (
                    <span className="font-medium text-green-700">OK</span>
                  ) : status === "over" ? (
                    <span className="font-medium text-danger">
                      Reduce to ≤ ₹{d!.maxNetPayable.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-gray-400">Fill MRP, net payable &amp; weight</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type AttributeValueRow = {
  /** Present = this exact row already exists in the DB (rename/reorder/activate/delete apply to it); absent = new. */
  id?: string;
  attributeId: string;
  value: string;
  slug: string;
  position: number;
  isActive: boolean;
};

export type VariantRow = {
  /** Present = this exact variant row already exists in the DB. */
  id?: string;
  attributeValueRefs: Array<{ attributeId: string; slug: string }>;
  sku: string;
  hsnCode: string;
  mrp: string;
  /**
   * What the seller actually types for a variant — a plain "sell this at
   * ₹X" price, not a discount type/amount (unlike the base product's
   * Pricing & discounts section, which still works the normal
   * mrp+discount way). discountType/discountValue below are still what
   * actually gets submitted (the schema/DB never changed) — they're
   * derived from mrp/sellingPrice at submit time (see toVariantInput's
   * sellingPriceToDiscount) and kept here only so an existing variant's
   * FLAT/PERCENTAGE discount can be loaded back into a starting selling
   * price when the form opens (see product-form-initial.ts's toVariantRow).
   */
  sellingPrice: string;
  /** "Net payable" price-mode input for this variant — see ConfigState.netPayableAmount. Only read when the form's priceEntryMode is NET_PAYABLE. */
  netPayableAmount: string;
  discountType: DiscountTypeInput;
  discountValue: string;
  minOrderQty: string;
  stockQty: string;
  minStockQty: string;
  reorderLevel: string;
  /** Dealer-only earning scheme, per unit of this variant (see packages/orders/src/loyalty-points.ts) — settable here for display symmetry on the customer side too, but only ever paid out on a DEALER order. */
  loyaltyPoints: string;
  height: string;
  breadth: string;
  length: string;
  weight: string;
  /** Per-variant now (not one shared product-wide choice) — only meaningful for a CUSTOMER row; a DEALER row is always forced to EXCLUDE_WITH_PRODUCT server-side regardless of what's stored here (see applyProductSubmission's resolveVariantRows), same rule the base ShippingFields component already enforces for the non-variant case. */
  shippingCalcMode: "INCLUDE_WITH_PRODUCT" | "EXCLUDE_WITH_PRODUCT";
  /** Whether this variant's tax rate is already baked into `sellingPrice`, or added on top — see ConfigState.taxCalcMode's identical doc comment. Unlike shippingCalcMode above, both CUSTOMER and DEALER rows use this freely (no server-side override). */
  taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
  /** Optional — a variant with no image of its own falls back to the product's primary image (see product-form-initial.ts / customer & dealer display pages). */
  imageUrl: string;
  imageAlt: string;
  /** Additional gallery images beyond the single cover image above — same primaryImageUrl/images split as the product level, falls back to the product's own carousel when empty. */
  images: ProductImageRow[];
  /** Optional — a variant with none falls back to the product's own video. */
  videoUrl: string;
  isActive: boolean;
  /** Product Card Design Spec §Variants — read-only display; changed via the immediate "Set as default" action (onSetDefaultVariant), not the bulk form save. */
  isDefault?: boolean;
  /** Client-only, never sent to the server (see toVariantInput's explicit field whitelist) — a stable per-row identity for a not-yet-saved variant's image-upload folder path, minted once when the row is created so it survives reordering/other rows being removed. Irrelevant once `id` is present (an existing DB variant always uploads to its own real id). */
  _localId?: string;
};

export type ProductImageRow = {
  /** Present = this exact ProductImage row already exists in the DB; absent = new. */
  id?: string;
  url: string;
  altText: string;
  position: number;
  isActive: boolean;
};

/** The six rich-text description fields, in one non-English language. */
/** The six rich-text fields edited under the Description section's language tabs. */
export type ProductDescriptionFields = {
  shortDescription: string;
  description: string;
  ingredients: string;
  howToUse: string;
  dosageInstructions: string;
  technicalInfo: string;
};

/** One language's full translatable set: the plain-text name plus the six rich-text fields. */
export type ProductDescriptionTranslation = {
  /** Plain-text display name for this language. Blank ⇒ storefront shows the English name. */
  name: string;
} & ProductDescriptionFields;

/** Prisma `Language` enum members other than the English source. */
export type NonEnglishLanguage = "HI" | "MR" | "TE" | "TA";
export const NON_ENGLISH_LANGUAGES: NonEnglishLanguage[] = ["HI", "MR", "TE", "TA"];

export type ProductFormInitial = {
  name?: string;
  slug?: string;
  sku?: string;
  hsnCode?: string;
  taxPercent?: string;
  priceEntryMode?: PriceEntryMode;
  shortDescription?: string;
  description?: string;
  ingredients?: string;
  howToUse?: string;
  dosageInstructions?: string;
  technicalInfo?: string;
  /** Per-language overrides of the six fields above. English stays in the fields above. */
  translations?: Partial<Record<NonEnglishLanguage, Partial<ProductDescriptionTranslation>>>;
  productType?: "PHYSICAL" | "DIGITAL";
  baseUnit?: "G" | "KG" | "ML" | "L" | "PIECE";
  packageSize?: string;
  searchTags?: string[];
  featuredPosition?: number;
  categoryId?: string;
  subCategoryId?: string;
  subSubCategoryId?: string;
  brandId?: string;
  manufacturerId?: string;
  audience?: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";
  customerVisible?: boolean;
  dealerVisible?: boolean;
  customerConfig?: ConfigState;
  dealerConfig?: ConfigState;
  attributeValues?: AttributeValueRow[];
  customerVariants?: VariantRow[];
  dealerVariants?: VariantRow[];
  customerStateIds?: string[];
  dealerStateIds?: string[];
  cropIds?: string[];
  pestDiseaseIds?: string[];
  primaryImageUrl?: string;
  videoUrl?: string;
  images?: ProductImageRow[];
  metaTitle?: string;
  metaDescription?: string;
  metaImageUrl?: string;
  // Product Card Design Spec §Admin Panel Controls.
  subtitle?: string;
  editorialBadgeId?: string;
  deliveryBadgeEnabled?: boolean;
  deliveryBadgeText?: string;
  availabilityBadgeMode?: "AUTOMATIC" | "MANUAL" | "OFF";
  availabilityBadgeText?: string;
};

export type ReferenceData = {
  categories: Array<{ id: string; name: string }>;
  subcategories: Array<{ id: string; name: string; categoryId: string }>;
  subSubCategories: Array<{ id: string; name: string; subCategoryId: string }>;
  brands: Array<{ id: string; name: string }>;
  manufacturers: Array<{ id: string; name: string }>;
  attributes: Array<{ id: string; name: string }>;
  states: Array<{ id: string; name: string }>;
  /** Homepage redesign, phase B — merchandising/discovery tags (active only). */
  crops: Array<{ id: string; name: string }>;
  pestsDiseases: Array<{ id: string; name: string }>;
  /** null = no active logistics-pricing config exists yet — see ShippingCostPreview, which shows a warning instead of silently computing zero. */
  logisticsConfig: ShippingConfigInput | null;
  /**
   * Per-audience settlement rates (seller commission, the three settlement
   * GST rates, fixed TCS/TDS, the collection-charge rule) powering the
   * "Net payable" price mode's live selling-price preview. null when they
   * can't be resolved (e.g. an admin form with no owning seller). The
   * server recomputes authoritatively on save regardless — see
   * @kisan4u/orders applyNetPayablePricing.
   */
  settlementPricing: {
    customer: NetPayableRateParams;
    dealer: NetPayableRateParams;
  } | null;
  /** Admin-only field (spec item #3) — always [] in the seller loader, since ProductForm hides the control entirely when isAdmin is false. Includes inactive badges too; the dropdown filters those out except for the product's own currently-assigned one. */
  editorialBadges: Array<{
    id: string;
    name: string;
    tone: "SUCCESS" | "WARNING" | "DANGER" | "INFO";
    isActive: boolean;
  }>;
};

type SaveResult = { ok: true; productId: string } | { ok: false; error: string };
type ActionResult = { ok: true } | { ok: false; error: string };
type FormErrors = Record<string, string>;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

/**
 * Mirrors `slugSchema` (@kisan4u/validators/primitives — trim + lowercase)
 * for building an (attributeId, slug) lookup key client-side. Matching the
 * server's own normalization here matters: an attribute value's slug field
 * can be hand-edited directly (see AttributeValuesEditor's plain "slug"
 * input, no auto-lowercasing), and before both `attributeValueRefSchema`
 * and `productAttributeValueInputSchema` normalized identically
 * server-side, a casing/whitespace difference between a value's own slug
 * and a variant's reference to it caused a real, confusing save failure
 * ("A variant referenced an attribute value that wasn't submitted") even
 * though the value genuinely was submitted. Comparing with the same
 * normalization here means this component's own "is this ref still
 * valid" checks (the pruning effect and toVariantInput's filter below)
 * agree with what the server will actually accept, instead of being
 * stricter than it and silently dropping a reference that would have
 * worked fine.
 */
function attributeValueKey(attributeId: string, slug: string): string {
  return `${attributeId}:${slug.trim().toLowerCase()}`;
}

/**
 * The inverse of calculateSellingPrice (@kisan4u/validators), scoped to
 * variant rows only — see VariantRow.sellingPrice's doc comment. A seller
 * types the price they actually want to sell a variant at; this converts
 * it into the FLAT discount that produces exactly that price, which is
 * still what actually gets submitted (discountType/discountValue) — the
 * schema and DB representation are unchanged, only how this one field is
 * edited in the UI. Selling at or above MRP is "no discount", never a
 * negative one; a blank/invalid selling price is also "no discount" (sells
 * at MRP), matching how a freshly generated variant row starts out.
 */
function sellingPriceToDiscount(
  mrp: number,
  sellingPrice: number,
): { discountType: DiscountTypeInput; discountValue: string } {
  if (!(mrp > 0) || !Number.isFinite(sellingPrice) || sellingPrice < 0 || sellingPrice >= mrp) {
    return { discountType: "NONE", discountValue: "0" };
  }
  const flat = Math.round((mrp - sellingPrice + Number.EPSILON) * 100) / 100;
  return { discountType: "FLAT", discountValue: String(flat) };
}

/**
 * The 12 card-style sections this form is organized into (redesign brief
 * §Product form). One flat scrolling page rather than a multi-step
 * wizard — a wizard would risk losing already-entered values if a later
 * step's validation blocked reaching an earlier one, which conflicts with
 * "preserve values after errors."
 */
const SECTIONS = [
  { id: "basic", label: "Basic information" },
  { id: "classification", label: "Category, brand & classification" },
  { id: "audience", label: "Customer & dealer audience" },
  { id: "description", label: "Description" },
  { id: "attributes", label: "Attributes & variants" },
  { id: "cardPricing", label: "Display on product card" },
  { id: "pricing", label: "Pricing & discounts" },
  { id: "inventory", label: "Inventory & availability" },
  { id: "images", label: "Images & media" },
  { id: "shipping", label: "Shipping & logistics" },
  { id: "badges", label: "Badges & merchandising" },
  { id: "seo", label: "SEO" },
  { id: "review", label: "Review & submit" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Maps a validation error key to the section it should count against, for the section-nav badges and the jump-to-first-error focus behavior. */
const ERROR_SECTION: Record<string, SectionId> = {
  name: "basic",
  slug: "basic",
  sku: "basic",
  hsnCode: "basic",
  taxPercent: "pricing",
  packageSize: "basic",
  categoryId: "classification",
  shortDescription: "description",
  description: "description",
  "customerConfig.mrp": "pricing",
  "dealerConfig.mrp": "pricing",
  "customerConfig.sku": "pricing",
  "dealerConfig.sku": "pricing",
  primaryImageUrl: "images",
};

/** Variant-row error keys are dynamic ("customerVariants.2.sku") — this maps any key with that shape to the "attributes" section, since sectionErrorCount/jumpToField key off ERROR_SECTION for the static keys above. */
function errorSection(key: string): SectionId | undefined {
  if (key in ERROR_SECTION) return ERROR_SECTION[key];
  if (key.startsWith("customerVariants.") || key.startsWith("dealerVariants.")) return "attributes";
  return undefined;
}

function FormSection({
  id,
  title,
  description,
  errorCount,
  children,
}: {
  id: SectionId;
  title: string;
  description?: string;
  errorCount: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-green-800">{title}</h2>
            {description && (
              <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{description}</p>
            )}
          </div>
          {errorCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-bg px-2.5 py-1 text-xs font-bold text-danger">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {errorCount}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </Card>
    </section>
  );
}

function SectionNav({ errorCounts }: { errorCounts: Record<SectionId, number> }) {
  return (
    <nav aria-label="Form sections" className="hidden lg:block">
      <div className="sticky top-6 flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-2">
        {SECTIONS.map((s) => {
          const count = errorCounts[s.id] ?? 0;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-green-50 hover:text-green-800 ${
                count > 0 ? "text-danger" : "text-gray-600"
              }`}
            >
              {s.label}
              {count > 0 && (
                <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[10px] font-bold text-danger">
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/** "-cus" / "-dea" per AUDIENCE_SKU_SUFFIX in @kisan4u/validators — the label shown next to the SKU field so the suffix rule is visible before the seller/admin ever hits a validation error. */
const AUDIENCE_SUFFIX_LABEL: Record<AudienceSkuAudience, string> = { CUSTOMER: "-cus", DEALER: "-dea" };

function PricingFields({
  idPrefix,
  label,
  audience,
  baseSku,
  value,
  onChange,
  errors,
  priceEntryMode,
  taxPercent,
  npRates,
  logisticsConfig,
}: {
  idPrefix: string;
  label: string;
  /** Which suffix ("-cus"/"-dea") this config's sku must end in. */
  audience: AudienceSkuAudience;
  /** The product's top-level SKU — seeds the "Generate" button's suggestion. */
  baseSku: string;
  value: ConfigState;
  onChange: (v: ConfigState) => void;
  errors: FormErrors;
  priceEntryMode: PriceEntryMode;
  taxPercent: number;
  /** This audience's settlement rates for the net-payable preview, or null when unavailable. */
  npRates: NetPayableRateParams | null;
  logisticsConfig: ShippingConfigInput | null;
}) {
  const sellingPrice = calculateSellingPrice(
    Number(value.mrp) || 0,
    value.discountType,
    Number(value.discountValue) || 0,
  );
  const npDerived =
    priceEntryMode === "NET_PAYABLE"
      ? deriveNetPayable({
          mrp: Number(value.mrp) || 0,
          weightGrams: Number(value.weight) || 0,
          netPayable: Number(value.netPayableAmount) || 0,
          taxCalcMode: value.taxCalcMode,
          taxPercent,
          rates: npRates,
          logisticsConfig,
        })
      : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-[13px] font-bold text-ink">{label}</h3>
      <div className="flex items-end gap-2">
        <FormInput
          id={`${idPrefix}.sku`}
          label="SKU"
          hint={`Must end in "${AUDIENCE_SUFFIX_LABEL[audience]}"`}
          placeholder={`e.g. TOMATO-SEED-500${AUDIENCE_SUFFIX_LABEL[audience]}`}
          value={value.sku}
          onChange={(e) => onChange({ ...value, sku: e.target.value })}
          error={errors[`${idPrefix}.sku`]}
          required
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const suggestion = normalizeAudienceSku(baseSku || `SKU-${Date.now().toString(36)}`, audience);
            onChange({ ...value, sku: suggestion.ok ? suggestion.sku : value.sku });
          }}
        >
          Generate
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          id={`${idPrefix}.mrp`}
          label="MRP"
          type="number"
          min="0"
          step="0.01"
          placeholder="Printed price, e.g. 250"
          value={value.mrp}
          onChange={(e) => onChange({ ...value, mrp: e.target.value })}
          error={errors[`${idPrefix}.mrp`]}
          required
        />
        {priceEntryMode === "NET_PAYABLE" ? (
          <FormInput
            id={`${idPrefix}.netPayableAmount`}
            label="Net payable amount"
            hint="What you want to receive per unit after settlement deductions"
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount you keep per unit, e.g. 180"
            value={value.netPayableAmount}
            onChange={(e) => onChange({ ...value, netPayableAmount: e.target.value })}
            error={errors[`${idPrefix}.netPayableAmount`]}
            required
          />
        ) : (
          <>
            <FormSelect
              label="Discount type"
              value={value.discountType}
              onChange={(e) =>
                onChange({ ...value, discountType: e.target.value as ConfigState["discountType"] })
              }
            >
              <option value="NONE">No discount</option>
              <option value="FLAT">Flat discount</option>
              <option value="PERCENTAGE">Percentage discount</option>
            </FormSelect>
            {value.discountType !== "NONE" && (
              <FormInput
                label={value.discountType === "FLAT" ? "Discount amount" : "Discount %"}
                type="number"
                min="0"
                step="0.01"
                placeholder={value.discountType === "FLAT" ? "₹ off MRP, e.g. 40" : "% off MRP, e.g. 15"}
                value={value.discountValue}
                onChange={(e) => onChange({ ...value, discountValue: e.target.value })}
              />
            )}
          </>
        )}
      </div>
      {priceEntryMode === "NET_PAYABLE" ? (
        npDerived === null ? (
          <p className="text-[13px] text-gray-500">
            Settlement rates aren&apos;t available here — the selling price will be worked out when
            you save.
          </p>
        ) : !npDerived.ready ? (
          <p className="text-[13px] text-gray-500">
            Enter MRP, net payable and a weight (in Shipping below) to see the selling price.
          </p>
        ) : (
          <div>
            <p className="text-[13px] text-gray-500">
              Selling price (from net payable):{" "}
              <strong className={npDerived.overMrp ? "text-danger" : "text-ink"}>
                ₹{npDerived.sellingPrice.toFixed(2)}
              </strong>
              {!npDerived.exact && " (closest achievable)"}
            </p>
            <NetPayableBar
              value={Number(value.netPayableAmount) || 0}
              ceiling={npDerived.maxNetPayable}
            />
            {npDerived.overMrp && (
              <p className="mt-1 text-[12px] font-medium text-danger">
                Above the MRP of ₹{(Number(value.mrp) || 0).toFixed(2)} — lower the net payable to at
                most ₹{npDerived.maxNetPayable.toFixed(2)}.
              </p>
            )}
          </div>
        )
      ) : (
        <p className="text-[13px] text-gray-500">
          Selling price (calculated): <strong className="text-ink">₹{sellingPrice.toFixed(2)}</strong>
        </p>
      )}
      <FormSelect
        id={`${idPrefix}.taxCalcMode`}
        label="Tax on selling price"
        hint="Is the tax rate above already baked into this price, or added on top at checkout?"
        value={value.taxCalcMode}
        onChange={(e) =>
          onChange({ ...value, taxCalcMode: e.target.value as ConfigState["taxCalcMode"] })
        }
      >
        <option value="INCLUDE_WITH_PRICE">Tax included in selling price</option>
        <option value="EXCLUDE_WITH_PRICE">Tax excluded from selling price</option>
      </FormSelect>
    </div>
  );
}

function InventoryFields({
  label,
  audience,
  value,
  onChange,
  isEditing,
}: {
  label: string;
  audience: AudienceSkuAudience;
  value: ConfigState;
  onChange: (v: ConfigState) => void;
  /** True once the product already exists (a real `productId` was passed to ProductForm). Stock quantity is a create-only field here — see product-submission.ts's toConfigData doc comment — every quantity change after creation must go through the Product Quantity page instead, so it's shown but disabled on edit. */
  isEditing: boolean;
}) {
  const reorderInvalid =
    value.reorderLevel !== "" &&
    value.minStockQty !== "" &&
    Number(value.reorderLevel) <= Number(value.minStockQty);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-[13px] font-bold text-ink">{label}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          label="Min order qty"
          type="number"
          min="1"
          placeholder="Smallest quantity a buyer can order, e.g. 1"
          value={value.minOrderQty}
          onChange={(e) => onChange({ ...value, minOrderQty: e.target.value })}
        />
        <FormInput
          label={isEditing ? "Current stock (opening value only)" : "Current stock"}
          type="number"
          min="0"
          placeholder={isEditing ? "Managed from Inventory Management" : "Units available now, e.g. 100"}
          value={value.currentStock}
          disabled={isEditing}
          onChange={(e) => onChange({ ...value, currentStock: e.target.value })}
        />
      </div>
      {isEditing && (
        <p className="text-xs text-gray-500">
          Stock quantity is managed from the Inventory Management page once a product exists, so
          every change is recorded in its history.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          label="Minimum quantity"
          type="number"
          min="0"
          placeholder="Flag as low stock at or below, e.g. 10"
          value={value.minStockQty}
          onChange={(e) => onChange({ ...value, minStockQty: e.target.value })}
        />
        <FormInput
          label="Reorder level"
          type="number"
          min="0"
          placeholder="Restock reminder threshold, e.g. 25"
          value={value.reorderLevel}
          error={
            reorderInvalid ? "Reorder level must be greater than minimum quantity." : undefined
          }
          onChange={(e) => onChange({ ...value, reorderLevel: e.target.value })}
        />
      </div>
      <FormInput
        label="Loyalty points"
        type="number"
        min="0"
        placeholder="Points earned per unit, e.g. 5 (0 for none)"
        value={value.loyaltyPoints}
        onChange={(e) => onChange({ ...value, loyaltyPoints: e.target.value })}
      />
      <p className="text-xs text-gray-500">
        {audience === "DEALER"
          ? "Awarded to the dealer once an order for this product is delivered. Not redeemable yet."
          : "Shown to the customer as \"Earn N points\" — not yet paid out (the earning scheme is dealer-only for now)."}
      </p>
    </div>
  );
}

/** Only ever rendered for a non-variant product now — a variant product tracks weight/dimensions AND its own shipping-inclusion choice per variant instead (see VariantsEditor's per-row shipping select below). */
function ShippingFields({
  label,
  audience,
  value,
  onChange,
  logisticsConfig,
}: {
  label: string;
  audience: AudienceSkuAudience;
  value: ConfigState;
  onChange: (v: ConfigState) => void;
  logisticsConfig: ShippingConfigInput | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-[13px] font-bold text-ink">{label}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          label="Weight (g)"
          type="number"
          min="0"
          placeholder="Packed weight in grams, e.g. 550"
          value={value.weight}
          onChange={(e) => onChange({ ...value, weight: e.target.value })}
        />
        <FormInput
          label="Height (m)"
          type="number"
          min="0"
          placeholder="Packed height in metres, e.g. 0.12"
          value={value.height}
          onChange={(e) => onChange({ ...value, height: e.target.value })}
        />
        <FormInput
          label="Breadth (m)"
          type="number"
          min="0"
          placeholder="Packed breadth in metres, e.g. 0.08"
          value={value.breadth}
          onChange={(e) => onChange({ ...value, breadth: e.target.value })}
        />
        <FormInput
          label="Length (m)"
          type="number"
          min="0"
          placeholder="Packed length in metres, e.g. 0.20"
          value={value.length}
          onChange={(e) => onChange({ ...value, length: e.target.value })}
        />
      </div>
      {audience === "DEALER" ? (
        <p className="rounded-md bg-bg-dashboard px-3 py-2 text-[13px] text-gray-600">
          Shipping excluded — delivery charges are calculated separately and arranged privately
          between the dealer and the transporter. Dealer pricing can never be marked
          shipping-inclusive.
        </p>
      ) : (
        <FormSelect
          label="Shipping calculation"
          value={value.shippingCalcMode}
          onChange={(e) =>
            onChange({
              ...value,
              shippingCalcMode: e.target.value as ConfigState["shippingCalcMode"],
            })
          }
        >
          <option value="INCLUDE_WITH_PRODUCT">Shipping included with product</option>
          <option value="EXCLUDE_WITH_PRODUCT">Shipping excluded from product</option>
        </FormSelect>
      )}
      <ShippingCostPreview weight={value.weight} logisticsConfig={logisticsConfig} />
    </div>
  );
}

/**
 * Manages the product-specific attribute VALUES (not the attribute master
 * list, which stays name-only and admin-managed at /admin/attributes).
 * Renaming/reordering/activating a value is just an in-place edit that
 * flows through the normal form save; deleting an already-persisted value
 * goes through `onRemove` immediately (server re-checks it isn't used by
 * any variant before allowing it) since that's a guarded operation the
 * bulk save path deliberately never performs on its own.
 */
function AttributeValuesEditor({
  attributes,
  values,
  onChange,
  onRemove,
}: {
  attributes: ReferenceData["attributes"];
  values: AttributeValueRow[];
  onChange: (v: AttributeValueRow[]) => void;
  onRemove?: (valueId: string) => Promise<ActionResult>;
}) {
  const [pendingAttributeId, setPendingAttributeId] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const usedAttributeIds = new Set(values.map((v) => v.attributeId));
  const availableToAdd = attributes.filter((a) => !usedAttributeIds.has(a.id));

  function updateValue(index: number, patch: Partial<AttributeValueRow>) {
    onChange(values.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }
  function addAttributeGroup() {
    if (!pendingAttributeId) return;
    onChange([
      ...values,
      { attributeId: pendingAttributeId, value: "", slug: "", position: 0, isActive: true },
    ]);
    setPendingAttributeId("");
  }
  function addValueRow(attributeId: string) {
    const position = values.filter((v) => v.attributeId === attributeId).length;
    onChange([...values, { attributeId, value: "", slug: "", position, isActive: true }]);
  }
  async function removeValueRow(index: number) {
    const row = values[index];
    if (!row) return;
    setRemoveError(null);
    if (row.id && onRemove) {
      const result = await onRemove(row.id);
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
    }
    onChange(values.filter((_, i) => i !== index));
  }
  function moveValue(attributeId: string, order: number, direction: -1 | 1) {
    const group = values
      .map((v, i) => ({ v, i }))
      .filter((x) => x.v.attributeId === attributeId)
      .sort((a, b) => a.v.position - b.v.position);
    const neighbor = group[order + direction];
    const current = group[order];
    if (!neighbor || !current) return;
    const next = [...values];
    const currentPos = current.v.position;
    next[current.i] = { ...current.v, position: neighbor.v.position };
    next[neighbor.i] = { ...neighbor.v, position: currentPos };
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {removeError && <AlertBox tone="danger">{removeError}</AlertBox>}
      {attributes
        .filter((a) => usedAttributeIds.has(a.id))
        .map((attr) => {
          const group = values
            .map((v, i) => ({ v, i }))
            .filter((x) => x.v.attributeId === attr.id)
            .sort((a, b) => a.v.position - b.v.position);
          return (
            <div key={attr.id} className="rounded-lg border border-border bg-bg-dashboard/60 p-3">
              <strong className="text-[13px] font-bold text-ink">{attr.name}</strong>
              <div className="mt-2 flex flex-col gap-2">
                {group.map(({ v, i }, order) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      placeholder="Value, e.g. Red"
                      value={v.value}
                      onChange={(e) =>
                        updateValue(i, {
                          value: e.target.value,
                          slug: v.slug || slugify(e.target.value),
                        })
                      }
                      className={`${rowFieldClass} min-w-[140px] flex-1`}
                    />
                    <input
                      placeholder="slug"
                      value={v.slug}
                      onChange={(e) => updateValue(i, { slug: e.target.value })}
                      className={`${rowFieldClass} w-32`}
                    />
                    <CheckboxField
                      checked={v.isActive}
                      onChange={(checked) => updateValue(i, { isActive: checked })}
                    >
                      Active
                    </CheckboxField>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => moveValue(attr.id, order, -1)}
                        disabled={order === 0}
                        aria-label="Move value up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => moveValue(attr.id, order, 1)}
                        disabled={order === group.length - 1}
                        aria-label="Move value down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => removeValueRow(i)}
                        aria-label={`Remove value ${v.value || "row"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => addValueRow(attr.id)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add value
              </Button>
            </div>
          );
        })}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pendingAttributeId}
          onChange={(e) => setPendingAttributeId(e.target.value)}
          className={`${rowFieldClass} w-auto bg-white`}
        >
          <option value="">— Add an attribute —</option>
          {availableToAdd.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addAttributeGroup}
          disabled={!pendingAttributeId}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add attribute to this product
        </Button>
      </div>
    </div>
  );
}

/**
 * Product Card Design Spec §Admin Panel Controls ("Images: Upload,
 * reorder, set default"). URL-only, matching this form's existing
 * primary-image convention — there's no upload/storage provider
 * configured in this project. "Set as default" copies the image's URL
 * into the Primary Image field above (the field the storefront falls back
 * to when no ProductImage carousel exists) rather than mutating this
 * list's own order, since "default/primary image" and "carousel order"
 * are two independent, already-separate concepts in the schema
 * (Product.primaryImageUrl vs ProductImage.position).
 */
function ImagesEditor({
  images,
  onChange,
  onSetPrimary,
  primaryImageUrl,
  onUploadImage,
  resolveDisplaySrc,
}: {
  images: ProductImageRow[];
  onChange: (v: ProductImageRow[]) => void;
  onSetPrimary: (url: string) => void;
  primaryImageUrl: string;
  onUploadImage?: (file: File) => Promise<ImageUploadResult>;
  resolveDisplaySrc?: (url: string) => string;
}) {
  const sorted = [...images].sort((a, b) => a.position - b.position);

  function update(index: number, patch: Partial<ProductImageRow>) {
    onChange(images.map((img, i) => (i === index ? { ...img, ...patch } : img)));
  }
  function remove(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }
  function add() {
    const nextPosition = images.length > 0 ? Math.max(...images.map((i) => i.position)) + 1 : 0;
    onChange([...images, { url: "", altText: "", position: nextPosition, isActive: true }]);
  }
  function move(sortedIndex: number, direction: -1 | 1) {
    const neighbor = sorted[sortedIndex + direction];
    const current = sorted[sortedIndex];
    if (!neighbor || !current) return;
    const currentPos = current.position;
    onChange(
      images.map((img) => {
        if (img === current) return { ...img, position: neighbor.position };
        if (img === neighbor) return { ...img, position: currentPos };
        return img;
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((img, order) => {
        const index = images.indexOf(img);
        return (
          <div
            key={img.id ?? index}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-dashboard/60 p-2.5"
          >
            <div className="min-w-[220px] flex-[2]">
              <ImageUploadField
                label={`Image ${order + 1}`}
                value={img.url}
                onChange={(url) => update(index, { url })}
                onUpload={
                  onUploadImage ??
                  (async () => ({ ok: false, error: "Upload is not available here." }))
                }
                resolveDisplaySrc={resolveDisplaySrc}
              />
            </div>
            <input
              placeholder="Alt text"
              value={img.altText}
              onChange={(e) => update(index, { altText: e.target.value })}
              className={`${rowFieldClass} min-w-[140px] flex-1 self-start`}
            />
            <CheckboxField
              checked={img.isActive}
              onChange={(checked) => update(index, { isActive: checked })}
            >
              Active
            </CheckboxField>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => move(order, -1)}
                disabled={order === 0}
                aria-label="Move image up"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => move(order, 1)}
                disabled={order === sorted.length - 1}
                aria-label="Move image down"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant={img.url && img.url === primaryImageUrl ? "secondary" : "outline"}
                size="sm"
                onClick={() => onSetPrimary(img.url)}
                disabled={!img.url || img.url === primaryImageUrl}
                title="Use this image as the primary/default product image"
              >
                {img.url && img.url === primaryImageUrl ? "Primary" : "Set as primary"}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => remove(index)}
                aria-label="Remove image"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={add}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add image
      </Button>
    </div>
  );
}

function VariantsEditor({
  label,
  audience,
  attributes,
  attributeValues,
  variants,
  onChange,
  onRemove,
  onSetDefault,
  logisticsConfig,
  onUploadVariantImage,
  resolveDisplaySrc,
  priceEntryMode,
  taxPercent,
  npRates,
}: {
  label: string;
  /** Which suffix ("-cus"/"-dea") every variant row's sku must end in. */
  audience: AudienceSkuAudience;
  attributes: ReferenceData["attributes"];
  attributeValues: AttributeValueRow[];
  variants: VariantRow[];
  onChange: (v: VariantRow[]) => void;
  onRemove?: (variantId: string) => Promise<ActionResult>;
  /** Product Card Design Spec §Variants — immediate action (not part of the bulk form save), since it must never leave more than one default set even under a half-finished edit. */
  onSetDefault?: (variantId: string) => Promise<ActionResult>;
  logisticsConfig: ShippingConfigInput | null;
  priceEntryMode: PriceEntryMode;
  taxPercent: number;
  /** This audience's settlement rates for the net-payable preview, or null when unavailable. */
  npRates: NetPayableRateParams | null;
  /** Absent when the caller has no way to resolve a productId yet (shouldn't happen in practice — ProductForm always mints a pending id — but kept optional so this component degrades to URL-only rather than crashing). */
  onUploadVariantImage?: (
    variantId: string,
    variantSlug: string,
    file: File,
  ) => Promise<ImageUploadResult>;
  resolveDisplaySrc?: (url: string) => string;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [genError, setGenError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);

  async function setDefaultVariant(index: number) {
    const row = variants[index];
    if (!row?.id || !onSetDefault) return;
    setDefaultError(null);
    const result = await onSetDefault(row.id);
    if (!result.ok) {
      setDefaultError(result.error);
      return;
    }
    onChange(variants.map((v, i) => ({ ...v, isDefault: i === index })));
  }

  const usedAttributeIds = [...new Set(attributeValues.map((v) => v.attributeId))];

  function toggleGenValue(attributeId: string, slug: string) {
    setSelected((prev) => {
      const current = prev[attributeId] ?? [];
      const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
      return { ...prev, [attributeId]: next };
    });
  }

  function generate() {
    setGenError(null);
    const attributeIdsWithSelection = usedAttributeIds.filter(
      (id) => (selected[id] ?? []).length > 0,
    );
    if (attributeIdsWithSelection.length === 0) {
      setGenError("Select at least one value under at least one attribute first.");
      return;
    }
    const valuesByAttribute = attributeIdsWithSelection.map((attributeId) =>
      (selected[attributeId] ?? []).map((slug) => ({ attributeId, slug })),
    );
    const combos = generateCombinations(valuesByAttribute);
    const existingKeys = new Set(variants.map((v) => combinationKeyFromRefs(v.attributeValueRefs)));
    const newRows: VariantRow[] = [];
    for (const combo of combos) {
      const key = combinationKeyFromRefs(combo);
      if (existingKeys.has(key)) continue;
      newRows.push({
        _localId: crypto.randomUUID(),
        attributeValueRefs: combo,
        sku: "",
        hsnCode: "",
        mrp: "",
        sellingPrice: "",
        netPayableAmount: "",
        discountType: "NONE",
        discountValue: "0",
        minOrderQty: "1",
        stockQty: "0",
        minStockQty: "5",
        reorderLevel: "10",
        loyaltyPoints: "0",
        height: "",
        breadth: "",
        length: "",
        weight: "",
        shippingCalcMode: "INCLUDE_WITH_PRODUCT",
        taxCalcMode: "INCLUDE_WITH_PRICE",
        imageUrl: "",
        imageAlt: "",
        images: [],
        videoUrl: "",
        isActive: true,
      });
    }
    if (newRows.length === 0) {
      setGenError("Every selected combination already exists below.");
      return;
    }
    onChange([...variants, ...newRows]);
  }

  function updateVariant(index: number, patch: Partial<VariantRow>) {
    onChange(variants.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }
  async function removeVariantRow(index: number) {
    const row = variants[index];
    if (!row) return;
    setRemoveError(null);
    if (row.id && onRemove) {
      const result = await onRemove(row.id);
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
    }
    onChange(variants.filter((_, i) => i !== index));
  }
  function labelFor(ref: { attributeId: string; slug: string }): string {
    const attr = attributes.find((a) => a.id === ref.attributeId);
    const val = attributeValues.find(
      (v) => v.attributeId === ref.attributeId && v.slug === ref.slug,
    );
    return `${attr?.name ?? "?"}: ${val?.value ?? ref.slug}`;
  }

  /**
   * Live, non-editable per-unit price for a variant row — derived from
   * `sellingPrice` (recalculated on every keystroke, since it's a pure
   * function of already-rendered form state, never a separate field to
   * keep in sync) ÷ the row's own "Case" attribute value, same formula/
   * convention as the storefront (see computeUnitPrice's doc comment).
   * Returns null (hide the readout) when this row has no "Case" attribute
   * value at all — a plain single-piece variant has no per-unit price to
   * show — or the effective selling price isn't known yet.
   */
  function unitPriceFor(row: VariantRow, effectiveSellingPrice: number | null): number | null {
    if (effectiveSellingPrice == null) return null;
    const rowAttributeValues = row.attributeValueRefs.map((ref) => {
      const attr = attributes.find((a) => a.id === ref.attributeId);
      const val = attributeValues.find(
        (v) => v.attributeId === ref.attributeId && v.slug === ref.slug,
      );
      return { attributeName: attr?.name ?? "", value: val?.value ?? "" };
    });
    return computeUnitPrice(effectiveSellingPrice, rowAttributeValues);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-bold text-ink">{label}</h3>
      {usedAttributeIds.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-dashboard/60 p-3">
          <p className="mb-2 text-[13px] text-gray-500">
            Pick values to generate variants — every combination of the values checked below will be
            added (skipping any combination that already exists).
          </p>
          <div className="flex flex-col gap-1.5">
            {usedAttributeIds.map((attributeId) => {
              const attr = attributes.find((a) => a.id === attributeId);
              const rows = attributeValues.filter(
                (v) => v.attributeId === attributeId && v.isActive,
              );
              if (rows.length === 0) return null;
              return (
                <div
                  key={attributeId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
                >
                  <strong className="text-ink">{attr?.name}:</strong>
                  {rows.map((v) => (
                    <label key={v.slug} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={(selected[attributeId] ?? []).includes(v.slug)}
                        onChange={() => toggleGenValue(attributeId, v.slug)}
                        className="h-3.5 w-3.5 rounded border-border accent-green-600"
                      />
                      {v.value}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={generate}>
            Generate variants
          </Button>
          {genError && (
            <p className="mt-2 text-[13px] font-medium text-danger" role="alert">
              {genError}
            </p>
          )}
        </div>
      )}

      {removeError && <AlertBox tone="danger">{removeError}</AlertBox>}
      {defaultError && <AlertBox tone="danger">{defaultError}</AlertBox>}
      {variants.map((variant, index) => {
        const mrpNumber = Number(variant.mrp) || 0;
        const sellingPriceNumber = Number(variant.sellingPrice) || 0;
        const discountOff =
          variant.sellingPrice.trim() && mrpNumber > 0 && sellingPriceNumber < mrpNumber
            ? mrpNumber - sellingPriceNumber
            : 0;
        const npDerived =
          priceEntryMode === "NET_PAYABLE"
            ? deriveNetPayable({
                mrp: mrpNumber,
                weightGrams: Number(variant.weight) || 0,
                netPayable: Number(variant.netPayableAmount) || 0,
                taxCalcMode: variant.taxCalcMode,
                taxPercent,
                rates: npRates,
                logisticsConfig,
              })
            : null;
        const effectiveSellingPrice =
          priceEntryMode === "NET_PAYABLE"
            ? npDerived && npDerived.ready
              ? npDerived.sellingPrice
              : null
            : sellingPriceNumber > 0
              ? sellingPriceNumber
              : null;
        const unitPrice = unitPriceFor(variant, effectiveSellingPrice);
        return (
          <div
            key={variant.id ?? index}
            className={`rounded-lg border p-3 ${variant.isDefault ? "border-[1.5px] border-green-600 bg-green-50/40" : "border-border"}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink">
                {variant.attributeValueRefs.map(labelFor).join(" / ")}
              </span>
              {variant.id && onSetDefault && (
                <Button
                  type="button"
                  variant={variant.isDefault ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setDefaultVariant(index)}
                  disabled={variant.isDefault}
                >
                  <Star className="h-3.5 w-3.5" aria-hidden="true" />
                  {variant.isDefault ? "Default variant" : "Set as default"}
                </Button>
              )}
            </div>
            <div className="mb-2 flex gap-2">
              <input
                placeholder={`SKU (must end in "${AUDIENCE_SUFFIX_LABEL[audience]}")`}
                value={variant.sku}
                onChange={(e) => updateVariant(index, { sku: e.target.value })}
                className={`${rowFieldClass} flex-1`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const suggestion = normalizeAudienceSku(
                    `SKU-${Date.now().toString(36).toUpperCase()}-${index}`,
                    audience,
                  );
                  if (suggestion.ok) updateVariant(index, { sku: suggestion.sku });
                }}
              >
                Generate SKU
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input
                placeholder="MRP"
                type="number"
                value={variant.mrp}
                onChange={(e) => updateVariant(index, { mrp: e.target.value })}
                onWheel={blurNumberInputOnWheel}
                className={rowFieldClass}
              />
              {priceEntryMode === "NET_PAYABLE" ? (
                <input
                  placeholder="Net payable"
                  type="number"
                  min="0"
                  value={variant.netPayableAmount}
                  onChange={(e) => updateVariant(index, { netPayableAmount: e.target.value })}
                  onWheel={blurNumberInputOnWheel}
                  className={rowFieldClass}
                  title="What you want to receive per unit after settlement deductions — the selling price is worked out from it."
                />
              ) : (
                <input
                  placeholder="Selling price"
                  type="number"
                  min="0"
                  value={variant.sellingPrice}
                  onChange={(e) => updateVariant(index, { sellingPrice: e.target.value })}
                  onWheel={blurNumberInputOnWheel}
                  className={rowFieldClass}
                  title="What this variant actually sells for — leave blank to sell at MRP with no discount."
                />
              )}
              <input
                placeholder="Min order qty"
                type="number"
                value={variant.minOrderQty}
                onChange={(e) => updateVariant(index, { minOrderQty: e.target.value })}
                onWheel={blurNumberInputOnWheel}
                className={rowFieldClass}
              />
              <input
                placeholder={variant.id ? "Stock (see Inventory Management page)" : "Stock"}
                type="number"
                value={variant.stockQty}
                disabled={!!variant.id}
                title={
                  variant.id
                    ? "Stock quantity is managed from the Inventory Management page once a variant exists, so every change is recorded in its history."
                    : undefined
                }
                onChange={(e) => updateVariant(index, { stockQty: e.target.value })}
                onWheel={blurNumberInputOnWheel}
                className={rowFieldClass}
              />
              <input
                placeholder="Min quantity"
                type="number"
                value={variant.minStockQty}
                onChange={(e) => updateVariant(index, { minStockQty: e.target.value })}
                onWheel={blurNumberInputOnWheel}
                className={rowFieldClass}
              />
              <input
                placeholder="Reorder level"
                type="number"
                value={variant.reorderLevel}
                onChange={(e) => updateVariant(index, { reorderLevel: e.target.value })}
                onWheel={blurNumberInputOnWheel}
                className={`${rowFieldClass} ${
                  variant.reorderLevel !== "" &&
                  variant.minStockQty !== "" &&
                  Number(variant.reorderLevel) <= Number(variant.minStockQty)
                    ? "border-danger"
                    : ""
                }`}
              />
              <input
                placeholder="Loyalty points"
                type="number"
                min="0"
                value={variant.loyaltyPoints}
                onChange={(e) => updateVariant(index, { loyaltyPoints: e.target.value })}
                onWheel={blurNumberInputOnWheel}
                className={rowFieldClass}
                title="Reward points earned per unit of this variant when a dealer's order is delivered."
              />
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="Weight"
                  type="number"
                  value={variant.weight}
                  onChange={(e) => updateVariant(index, { weight: e.target.value })}
                  onWheel={blurNumberInputOnWheel}
                  className={`${rowFieldClass} flex-1`}
                />
                <span className="text-[13px] text-gray-500">g</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="Height"
                  type="number"
                  value={variant.height}
                  onChange={(e) => updateVariant(index, { height: e.target.value })}
                  onWheel={blurNumberInputOnWheel}
                  className={`${rowFieldClass} flex-1`}
                />
                <span className="text-[13px] text-gray-500">m</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="Breadth"
                  type="number"
                  value={variant.breadth}
                  onChange={(e) => updateVariant(index, { breadth: e.target.value })}
                  onWheel={blurNumberInputOnWheel}
                  className={`${rowFieldClass} flex-1`}
                />
                <span className="text-[13px] text-gray-500">m</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="Length"
                  type="number"
                  value={variant.length}
                  onChange={(e) => updateVariant(index, { length: e.target.value })}
                  onWheel={blurNumberInputOnWheel}
                  className={`${rowFieldClass} flex-1`}
                />
                <span className="text-[13px] text-gray-500">m</span>
              </div>
            </div>
            <div className="mt-2">
              {audience === "DEALER" ? (
                <p className="rounded-md bg-bg-dashboard px-3 py-2 text-[13px] text-gray-600">
                  Shipping excluded — delivery charges are calculated separately and arranged
                  privately between the dealer and the transporter.
                </p>
              ) : (
                <select
                  aria-label="Shipping calculation for this variant"
                  value={variant.shippingCalcMode}
                  onChange={(e) =>
                    updateVariant(index, {
                      shippingCalcMode: e.target.value as VariantRow["shippingCalcMode"],
                    })
                  }
                  className={`${rowFieldClass} w-full bg-white sm:w-auto`}
                >
                  <option value="INCLUDE_WITH_PRODUCT">Shipping included with product</option>
                  <option value="EXCLUDE_WITH_PRODUCT">Shipping excluded from product</option>
                </select>
              )}
            </div>
            <div className="mt-2">
              <select
                aria-label="Tax on this variant's selling price"
                value={variant.taxCalcMode}
                onChange={(e) =>
                  updateVariant(index, {
                    taxCalcMode: e.target.value as VariantRow["taxCalcMode"],
                  })
                }
                className={`${rowFieldClass} w-full bg-white sm:w-auto`}
              >
                <option value="INCLUDE_WITH_PRICE">Tax included in selling price</option>
                <option value="EXCLUDE_WITH_PRICE">Tax excluded from selling price</option>
              </select>
            </div>
            {variant.reorderLevel !== "" &&
              variant.minStockQty !== "" &&
              Number(variant.reorderLevel) <= Number(variant.minStockQty) && (
                <p className="mt-1 text-xs text-danger">
                  Reorder level must be greater than minimum quantity.
                </p>
              )}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <div className="flex-[2]">
                <ImageUploadField
                  label="Variant image"
                  hint="Optional — falls back to the product image"
                  value={variant.imageUrl}
                  onChange={(url) => updateVariant(index, { imageUrl: url })}
                  onUpload={async (file) => {
                    if (!onUploadVariantImage)
                      return { ok: false, error: "Upload is not available here." };
                    const id = variant.id ?? variant._localId ?? crypto.randomUUID();
                    if (!variant.id && !variant._localId) updateVariant(index, { _localId: id });
                    const slug = variant.sku || `variant-${index + 1}`;
                    return onUploadVariantImage(id, slug, file);
                  }}
                  resolveDisplaySrc={resolveDisplaySrc}
                />
              </div>
              <input
                placeholder="Image alt text (optional)"
                value={variant.imageAlt}
                onChange={(e) => updateVariant(index, { imageAlt: e.target.value })}
                className={`${rowFieldClass} flex-1 self-start sm:mt-6`}
              />
            </div>
            <div className="mt-2">
              <p className="mb-1.5 text-[13px] font-semibold text-gray-600">
                Additional images for this variant{" "}
                <span className="font-normal text-gray-400">
                  (optional — falls back to the product's own carousel below when empty)
                </span>
              </p>
              <ImagesEditor
                images={variant.images}
                onChange={(imgs) => updateVariant(index, { images: imgs })}
                onSetPrimary={(url) => updateVariant(index, { imageUrl: url })}
                primaryImageUrl={variant.imageUrl}
                onUploadImage={async (file) => {
                  if (!onUploadVariantImage)
                    return { ok: false, error: "Upload is not available here." };
                  const id = variant.id ?? variant._localId ?? crypto.randomUUID();
                  if (!variant.id && !variant._localId) updateVariant(index, { _localId: id });
                  const slug = variant.sku || `variant-${index + 1}`;
                  return onUploadVariantImage(id, slug, file);
                }}
                resolveDisplaySrc={resolveDisplaySrc}
              />
            </div>
            <div className="mt-2">
              <FormInput
                label="Variant video URL"
                hint="Optional — falls back to the product's own video when empty"
                placeholder="https://youtube.com/watch?v=…"
                value={variant.videoUrl}
                onChange={(e) => updateVariant(index, { videoUrl: e.target.value })}
              />
            </div>
            {priceEntryMode !== "NET_PAYABLE" && discountOff > 0 && (
              <p className="my-2 text-[13px] text-gray-500">
                ₹{discountOff.toFixed(2)} off MRP
                {mrpNumber > 0 && (
                  <> ({((discountOff / mrpNumber) * 100).toFixed(0)}% discount)</>
                )}
                .
              </p>
            )}
            {priceEntryMode === "NET_PAYABLE" && npDerived && npDerived.ready && (
              <div className="my-2">
                <p className="text-[13px] text-gray-500">
                  Selling price (from net payable):{" "}
                  <strong className={npDerived.overMrp ? "text-danger" : "text-ink"}>
                    ₹{npDerived.sellingPrice.toFixed(2)}
                  </strong>
                  {!npDerived.exact && " (closest achievable)"}
                </p>
                <NetPayableBar
                  value={Number(variant.netPayableAmount) || 0}
                  ceiling={npDerived.maxNetPayable}
                />
                {npDerived.overMrp && (
                  <p className="mt-1 text-[12px] font-medium text-danger">
                    Above the MRP of ₹{mrpNumber.toFixed(2)} — lower the net payable to at most ₹
                    {npDerived.maxNetPayable.toFixed(2)}.
                  </p>
                )}
              </div>
            )}
            {priceEntryMode === "NET_PAYABLE" && npDerived && !npDerived.ready && (
              <p className="my-2 text-[13px] text-gray-500">
                Enter MRP, net payable and a weight to see this variant&apos;s selling price.
              </p>
            )}
            {unitPrice != null && (
              <p className="my-2 text-[13px] text-gray-500">
                Per-unit price: <strong className="text-ink">₹{unitPrice.toFixed(2)}</strong>{" "}
                <span className="text-gray-400">
                  (auto-calculated from selling price ÷ this variant&apos;s &quot;Case&quot; quantity)
                </span>
              </p>
            )}
            <ShippingCostPreview weight={variant.weight} logisticsConfig={logisticsConfig} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <CheckboxField
                checked={variant.isActive}
                onChange={(checked) => updateVariant(index, { isActive: checked })}
              >
                Active (deactivate instead of removing to keep this combination out of the catalogue
                without losing its data)
              </CheckboxField>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => removeVariantRow(index)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProductForm({
  reference,
  initial,
  sellerId,
  productId,
  isAdmin = false,
  onSave,
  onSubmitForApproval,
  onRemoveVariant,
  onRemoveAttributeValue,
  onSetDefaultVariant,
  onUploadProductImage,
  onUploadVariantImage,
  submitLabel,
  redirectBasePath,
  storefrontBaseUrl,
  requireFullValidationOnSave,
}: {
  reference: ReferenceData;
  initial?: ProductFormInitial;
  /** null = in-house/admin product with no owning seller — licence eligibility never applies, taxonomy/audience/states behave exactly as before this module. */
  sellerId: string | null;
  /** Gates the admin-only merchandising fields (editorial badge, availability badge, delivery badge, featured position) — hidden/locked for a seller, editable for an admin. Enforced again server-side in applyProductSubmission regardless of what this prop says, since it's only a UI convenience. Default false. */
  isAdmin?: boolean;
  /** Absent on the create form (the product doesn't exist yet — see pendingProductId below). Present (the real DB id) on every edit form. */
  productId?: string;
  /**
   * A Server Action reference — either the create action directly, or an
   * update action pre-bound to this product's id via `.bind(null, id)` at
   * the call site (see seller/products/[id]/page.tsx and
   * admin/products/[id]/edit/page.tsx). Deliberately NOT `(id, input) =>
   * updateProductAction(id, input)`: wrapping a Server Action in a plain
   * arrow function makes it a fresh, non-serializable client-side closure
   * from Next.js's point of view (that pattern is what caused this to 500
   * with "Functions cannot be passed directly to Client Components") — a
   * bound Server Action reference is the one shape Next.js can still pass
   * across the Server/Client boundary.
   */
  onSave: (input: ProductSubmissionRawInput) => Promise<SaveResult>;
  /**
   * Present only where a "Submit for approval" flow actually exists — the
   * seller's own create/edit pages (bound to submitProductAction). Absent
   * for the admin edit form (admin approves/rejects elsewhere; editing a
   * product doesn't submit it) — the button is hidden entirely rather than
   * shown disabled, since "not applicable here" and "blocked right now"
   * are different things worth showing differently.
   */
  onSubmitForApproval?: (productId: string) => Promise<ActionResult>;
  onRemoveVariant?: (variantId: string) => Promise<ActionResult>;
  onRemoveAttributeValue?: (valueId: string) => Promise<ActionResult>;
  /** Product Card Design Spec §Variants — see VariantsEditor's onSetDefault doc comment. Absent on the create form (a variant needs to exist/be saved first). */
  onSetDefaultVariant?: (variantId: string) => Promise<ActionResult>;
  /** Absent = image upload isn't available (URL entry still works) — e.g. an in-house/admin-created product with no seller to scope the folder under. */
  onUploadProductImage?: (
    productId: string,
    slug: string,
    file: File,
  ) => Promise<ImageUploadResult>;
  onUploadVariantImage?: (
    productId: string,
    productSlug: string,
    variantId: string,
    variantSlug: string,
    file: File,
  ) => Promise<ImageUploadResult>;
  submitLabel?: string;
  /** Plain path prefix (e.g. "/seller/products") — the saved product's id is appended client-side. Kept as a string, not a function: Server Components cannot pass arbitrary closures into a Client Component. */
  redirectBasePath: string;
  /**
   * apps/dashboard's own `process.env.STOREFRONT_PUBLIC_URL` server-side
   * value (see apps/dashboard/src/lib/storefront-url.ts) — passed down as
   * a plain string rather than read here directly, since this component
   * is "use client" and a non-`NEXT_PUBLIC_` env var is `undefined` in the
   * browser bundle. Every uploaded image (primary, gallery, variant) is
   * stored as a path relative to apps/web (the app that actually serves
   * `/api/uploads/...`); rendered as-is on a dashboard page it 404s,
   * since the dashboard is a separate origin with no such route. `null`
   * degrades to showing the bare relative path (today's pre-existing
   * behavior) rather than crashing.
   */
  storefrontBaseUrl?: string | null;
  /**
   * Set only when editing an already-APPROVED (live) product — see
   * seller/products/[id]/edit/page.tsx. That save goes through the full
   * strict schema server-side (updateProductAction), not the lenient
   * "save at any point" draft path, so the client-side pre-flight must
   * match: every mandatory field is checked before submitting, exactly
   * like the Submit for approval button's own validateForSubmission(),
   * instead of the usual name-only check.
   */
  requireFullValidationOnSave?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  // Minted the first time an image is uploaded on the CREATE form (no real
  // productId exists yet) — reused as the product's actual primary key on
  // save (see buildSubmission's `id` field), so the folder the image was
  // already uploaded to is correct from the start. Irrelevant once
  // `productId` (a real, already-saved product) is passed in.
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [hsnCode, setHsnCode] = useState(initial?.hsnCode ?? "");
  // Single tax rate for the whole product — see Product.taxPercent's
  // schema comment. Rendered once in the "Pricing & discounts" section
  // below, regardless of audience or variants.
  const [taxPercent, setTaxPercent] = useState(initial?.taxPercent ?? "0");
  // How pricing is entered for the whole product — a plain selling price /
  // MRP+discount (default, unchanged behaviour), or a target net payable
  // that the form and server back-solve the selling price from. See the
  // Prisma PriceEntryMode enum and @kisan4u/validators net-payable.ts.
  const [priceEntryMode, setPriceEntryMode] = useState<PriceEntryMode>(
    initial?.priceEntryMode ?? "SELLING_PRICE",
  );
  const taxPercentNumber = Number(taxPercent) || 0;
  const customerNpRates = reference.settlementPricing?.customer ?? null;
  const dealerNpRates = reference.settlementPricing?.dealer ?? null;
  const [shortDescription, setShortDescription] = useState(initial?.shortDescription ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [ingredients, setIngredients] = useState(initial?.ingredients ?? "");
  const [howToUse, setHowToUse] = useState(initial?.howToUse ?? "");
  const [dosageInstructions, setDosageInstructions] = useState(initial?.dosageInstructions ?? "");
  const [technicalInfo, setTechnicalInfo] = useState(initial?.technicalInfo ?? "");
  // Storefront i18n — the Description section is edited one language at a
  // time. English is the six state hooks above (the source, stored on the
  // Product row); the other four languages live here and are stored as
  // ProductTranslation rows, each field falling back to English on the
  // storefront when left blank.
  const [descLang, setDescLang] = useState<"EN" | NonEnglishLanguage>("EN");
  const [translations, setTranslations] = useState<
    Record<NonEnglishLanguage, ProductDescriptionTranslation>
  >(() => {
    const blank = (): ProductDescriptionTranslation => ({
      name: "",
      shortDescription: "",
      description: "",
      ingredients: "",
      howToUse: "",
      dosageInstructions: "",
      technicalInfo: "",
    });
    const seed: Record<NonEnglishLanguage, ProductDescriptionTranslation> = {
      HI: blank(),
      MR: blank(),
      TE: blank(),
      TA: blank(),
    };
    for (const lang of NON_ENGLISH_LANGUAGES) {
      const existing = initial?.translations?.[lang];
      if (existing) seed[lang] = { ...seed[lang], ...existing };
    }
    return seed;
  });

  const descIsEnglish = descLang === "EN";
  const englishDescSetters: Record<keyof ProductDescriptionFields, (v: string) => void> = {
    shortDescription: setShortDescription,
    description: setDescription,
    ingredients: setIngredients,
    howToUse: setHowToUse,
    dosageInstructions: setDosageInstructions,
    technicalInfo: setTechnicalInfo,
  };
  const descValues: ProductDescriptionFields = descIsEnglish
    ? { shortDescription, description, ingredients, howToUse, dosageInstructions, technicalInfo }
    : translations[descLang];
  const setDescField = (field: keyof ProductDescriptionFields, value: string) => {
    if (descIsEnglish) {
      englishDescSetters[field](value);
    } else {
      setTranslations((prev) => ({
        ...prev,
        [descLang]: { ...prev[descLang], [field]: value },
      }));
    }
  };
  const descLangOptions = LANGUAGES.map((l) => ({
    value: l.dbValue as "EN" | NonEnglishLanguage,
    label: l.code === "en" ? "English" : l.nativeLabel,
  }));
  const [productType, setProductType] = useState<"PHYSICAL" | "DIGITAL">(
    initial?.productType ?? "PHYSICAL",
  );
  const [baseUnit, setBaseUnit] = useState<"G" | "KG" | "ML" | "L" | "PIECE">(
    initial?.baseUnit ?? "PIECE",
  );
  const [packageSize, setPackageSize] = useState(initial?.packageSize ?? "");
  const [searchTags, setSearchTags] = useState((initial?.searchTags ?? []).join(", "));
  const [featuredPosition, setFeaturedPosition] = useState(
    initial?.featuredPosition?.toString() ?? "",
  );

  const [categoryId, setCategoryId] = useState(
    initial?.categoryId ?? reference.categories[0]?.id ?? "",
  );
  const [subCategoryId, setSubCategoryId] = useState(initial?.subCategoryId ?? "");
  const [subSubCategoryId, setSubSubCategoryId] = useState(initial?.subSubCategoryId ?? "");
  const [brandId, setBrandId] = useState(initial?.brandId ?? "");
  const [manufacturerId, setManufacturerId] = useState(initial?.manufacturerId ?? "");

  const [audience, setAudience] = useState<
    "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER"
  >(initial?.audience ?? "CUSTOMER_ONLY");
  const [customerVisible, setCustomerVisible] = useState(initial?.customerVisible ?? true);
  const [dealerVisible, setDealerVisible] = useState(initial?.dealerVisible ?? true);

  const needsCustomer = audience === "CUSTOMER_ONLY" || audience === "BOTH_CUSTOMER_AND_DEALER";
  const needsDealer = audience === "DEALER_ONLY" || audience === "BOTH_CUSTOMER_AND_DEALER";

  const [customerConfig, setCustomerConfig] = useState<ConfigState>(
    initial?.customerConfig ?? EMPTY_CONFIG,
  );
  const [dealerConfig, setDealerConfig] = useState<ConfigState>(
    initial?.dealerConfig ?? EMPTY_CONFIG,
  );
  const [attributeValues, setAttributeValues] = useState<AttributeValueRow[]>(
    initial?.attributeValues ?? [],
  );
  const [customerVariants, setCustomerVariants] = useState<VariantRow[]>(initial?.customerVariants ?? []);
  const [dealerVariants, setDealerVariants] = useState<VariantRow[]>(initial?.dealerVariants ?? []);

  /**
   * Renaming an attribute value's slug or deleting it entirely must not
   * leave a variant row silently pointing at a value that no longer
   * exists — without this, the variant's summary line falls back to
   * showing the raw slug instead of a real name, and saving fails later
   * with a confusing "referenced an attribute value that wasn't
   * submitted" error instead of a clear one. Every (attributeId, slug)
   * pair still present in `attributeValues` — active or not, since
   * deactivating a value is reversible and shouldn't touch variants
   * already using it — is "valid"; anything else gets stripped from every
   * variant's attributeValueRefs the moment it disappears. A plain rename
   * (value text changes, slug unchanged) never triggers this — labelFor
   * already looks up the current name live — this only fires when the
   * (attributeId, slug) KEY itself changes or is removed.
   */
  const attributeValueKeys = useMemo(
    () => new Set(attributeValues.map((v) => attributeValueKey(v.attributeId, v.slug))),
    [attributeValues],
  );
  useEffect(() => {
    function pruneStaleRefs(rows: VariantRow[]): VariantRow[] {
      let changed = false;
      const next = rows.map((row) => {
        const keptRefs = row.attributeValueRefs.filter((ref) =>
          attributeValueKeys.has(attributeValueKey(ref.attributeId, ref.slug)),
        );
        if (keptRefs.length !== row.attributeValueRefs.length) {
          changed = true;
          return { ...row, attributeValueRefs: keptRefs };
        }
        return row;
      });
      return changed ? next : rows;
    }
    setCustomerVariants((prev) => pruneStaleRefs(prev));
    setDealerVariants((prev) => pruneStaleRefs(prev));
  }, [attributeValueKeys]);

  // "Does this product have variants?" — asked upfront so the form only
  // shows the section that actually applies: a variant product manages
  // pricing/inventory per-variant (below, in Attributes & variants) and
  // never needs the base-level Pricing/Inventory sections; a non-variant
  // product never needs the variant editor. There's no separate DB column
  // for this — it's derived from whether any variant rows already exist,
  // same convention the bulk "Add Multiple Products" grid already uses
  // (see loadExistingProductForBulkRecall in packages/catalog).
  const [hasVariants, setHasVariants] = useState<boolean>(
    (initial?.customerVariants?.length ?? 0) > 0 || (initial?.dealerVariants?.length ?? 0) > 0,
  );
  const [hasVariantsSwitchWarning, setHasVariantsSwitchWarning] = useState(false);

  // Recap rows for the "Net payable" summary table — every sellable unit's
  // back-solved selling price vs. its MRP and net-payable ceiling.
  const netPayableSummaryRows = useMemo<NetPayableSummaryRow[]>(() => {
    if (priceEntryMode !== "NET_PAYABLE") return [];
    const rows: NetPayableSummaryRow[] = [];
    const add = (
      label: string,
      audienceLabel: "Customer" | "Dealer",
      unit: Pick<ConfigState, "mrp" | "weight" | "netPayableAmount" | "taxCalcMode"> & {
        isActive?: boolean;
      },
      rates: NetPayableRateParams | null,
    ) => {
      const mrp = Number(unit.mrp) || 0;
      const netPayable = Number(unit.netPayableAmount) || 0;
      rows.push({
        label,
        audience: audienceLabel,
        active: unit.isActive ?? true,
        netPayable,
        mrp,
        derived: deriveNetPayable({
          mrp,
          weightGrams: Number(unit.weight) || 0,
          netPayable,
          taxCalcMode: unit.taxCalcMode,
          taxPercent: taxPercentNumber,
          rates,
          logisticsConfig: reference.logisticsConfig,
        }),
      });
    };
    if (hasVariants) {
      if (needsCustomer)
        customerVariants.forEach((v, i) =>
          add(v.sku || `Customer variant ${i + 1}`, "Customer", v, customerNpRates),
        );
      if (needsDealer)
        dealerVariants.forEach((v, i) =>
          add(v.sku || `Dealer variant ${i + 1}`, "Dealer", v, dealerNpRates),
        );
    } else {
      if (needsCustomer) add("Customer configuration", "Customer", customerConfig, customerNpRates);
      if (needsDealer) add("Dealer configuration", "Dealer", dealerConfig, dealerNpRates);
    }
    return rows;
  }, [
    priceEntryMode,
    hasVariants,
    needsCustomer,
    needsDealer,
    customerConfig,
    dealerConfig,
    customerVariants,
    dealerVariants,
    taxPercentNumber,
    customerNpRates,
    dealerNpRates,
    reference.logisticsConfig,
  ]);

  function applyHasVariantsChange(next: boolean) {
    if (!next) {
      // Never silently discard a real, saved variant — deactivate it
      // instead (the same "prefer deactivation over deletion" rule this
      // codebase already applies elsewhere, e.g. suspend vs. delete on the
      // admin product list) so the next save turns it off without risking
      // an "in use, can't delete" failure. A brand-new, never-saved row
      // (no `id` yet) has nothing to preserve and is simply dropped.
      setCustomerVariants((prev) =>
        prev.filter((v) => v.id).map((v) => ({ ...v, isActive: false })),
      );
      setDealerVariants((prev) => prev.filter((v) => v.id).map((v) => ({ ...v, isActive: false })));
    }
    setHasVariants(next);
    setHasVariantsSwitchWarning(false);
  }

  function handleHasVariantsChange(next: boolean) {
    if (!next && (customerVariants.length > 0 || dealerVariants.length > 0)) {
      setHasVariantsSwitchWarning(true);
      return;
    }
    applyHasVariantsChange(next);
  }

  const [customerStateIds, setCustomerStateIds] = useState<string[]>(
    initial?.customerStateIds ?? [],
  );
  const [dealerStateIds, setDealerStateIds] = useState<string[]>(initial?.dealerStateIds ?? []);
  const [cropIds, setCropIds] = useState<string[]>(initial?.cropIds ?? []);
  const [pestDiseaseIds, setPestDiseaseIds] = useState<string[]>(initial?.pestDiseaseIds ?? []);

  // Selling-licence module: fetched once per taxonomy-path change (spec §5
  // "Recalculate the result whenever the category path changes") — reused
  // by the classification section's hint, the audience option gating, and
  // both LicenceStatesSelector instances, so it's one fetch per change
  // rather than one per consumer. Never trusted as the final word — the
  // server independently re-clamps/re-validates on every save (see
  // packages/catalog/src/product-submission.ts).
  const [eligibility, setEligibility] = useState<SellingLicenceEligibilityResult | null>(null);
  useEffect(() => {
    if (!sellerId || !categoryId) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    getProductLicenceEligibilityAction(sellerId, {
      categoryId,
      subCategoryId: subCategoryId || null,
      subSubCategoryId: subSubCategoryId || null,
    }).then((result) => {
      if (!cancelled && result.ok) setEligibility(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [sellerId, categoryId, subCategoryId, subSubCategoryId]);

  const customerAudienceEnabled = !eligibility || eligibility.customer.eligibleStateIds.length > 0;
  const dealerAudienceEnabled = !eligibility || eligibility.dealer.eligibleStateIds.length > 0;

  const [primaryImageUrl, setPrimaryImageUrl] = useState(initial?.primaryImageUrl ?? "");
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? "");
  const [images, setImages] = useState<ProductImageRow[]>(initial?.images ?? []);

  const [metaTitle, setMetaTitle] = useState(initial?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(initial?.metaDescription ?? "");
  const [metaImageUrl, setMetaImageUrl] = useState(initial?.metaImageUrl ?? "");

  // Product Card Design Spec §Admin Panel Controls.
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [editorialBadgeId, setEditorialBadgeId] = useState(initial?.editorialBadgeId ?? "");
  const [deliveryBadgeEnabled, setDeliveryBadgeEnabled] = useState(
    initial?.deliveryBadgeEnabled ?? false,
  );
  const [deliveryBadgeText, setDeliveryBadgeText] = useState(initial?.deliveryBadgeText ?? "");
  const [availabilityBadgeMode, setAvailabilityBadgeMode] = useState<
    "AUTOMATIC" | "MANUAL" | "OFF"
  >(initial?.availabilityBadgeMode ?? "AUTOMATIC");
  const [availabilityBadgeText, setAvailabilityBadgeText] = useState(
    initial?.availabilityBadgeText ?? "",
  );

  const subcategoryOptions = reference.subcategories.filter((s) => s.categoryId === categoryId);
  const subSubCategoryOptions = reference.subSubCategories.filter(
    (s) => s.subCategoryId === subCategoryId,
  );

  function generateSku(prefix: string, setter: (v: string) => void) {
    setter(`${prefix || "SKU"}-${Date.now().toString(36).toUpperCase()}`);
  }

  function toConfigInput(c: ConfigState) {
    // In net-payable mode the server back-solves discountType/discountValue
    // from netPayableAmount (see @kisan4u/orders applyNetPayablePricing) —
    // send a clean "no discount" so nothing stale rides along, and pass the
    // seller-entered net payable through for that conversion + persistence.
    const npa =
      priceEntryMode === "NET_PAYABLE" && c.netPayableAmount.trim()
        ? Number(c.netPayableAmount)
        : undefined;
    return {
      sku: c.sku,
      // One HSN per product — the "Basic information" field. The server
      // still stores it per audience config / variant, so it is stamped on.
      hsnCode,
      mrp: c.mrp,
      discountType: npa != null ? "NONE" : c.discountType,
      discountValue: npa != null ? "0" : c.discountValue,
      netPayableAmount: npa,
      minOrderQty: c.minOrderQty,
      currentStock: c.currentStock,
      minStockQty: c.minStockQty,
      reorderLevel: c.reorderLevel,
      loyaltyPoints: c.loyaltyPoints ? Number(c.loyaltyPoints) : undefined,
      height: c.height || undefined,
      breadth: c.breadth || undefined,
      length: c.length || undefined,
      weight: c.weight || undefined,
      shippingCalcMode: c.shippingCalcMode,
      taxCalcMode: c.taxCalcMode,
    };
  }

  /**
   * A variant product still needs a base customerConfig/dealerConfig row
   * server-side — productSubmissionSchema requires one for any audience
   * that's needed, with no exception for a variant product (the base
   * Pricing/Inventory sections are hidden, not removed from the data
   * model). Everything BUT price is a safe, inert placeholder here,
   * mirroring the first variant row's HSN/weight so the shipping-cost/HSN
   * it carries is at least plausible — never a second real stock pool
   * (currentStock is always 0; the variants are the only real inventory).
   * Same approach the bulk "Add Multiple Products" grid already uses for
   * the identical constraint (see placeholderConfigForVariantGroup in
   * packages/catalog/src/bulk-product-submission.ts).
   *
   * Price is DIFFERENT: `c.mrp`/`c.sellingPrice` here are the real values
   * the seller typed into the "Display on product card" section below —
   * this is the one thing a variant product's base config is actually
   * FOR now (the product card shows this, not any specific variant's
   * price — see product-card-adapter.ts). Tax rate is no longer part of
   * this per-audience config at all — it's the single top-level
   * `taxPercent` field (see Product.taxPercent's schema comment).
   */
  function variantBaseConfig(c: ConfigState, variants: VariantRow[]): ConfigState {
    const sample = variants[0];
    const { discountType, discountValue } = sellingPriceToDiscount(
      Number(c.mrp) || 0,
      Number(c.sellingPrice) || 0,
    );
    return {
      sku: `${slug || sku || "product"}-base`,
      hsnCode: hsnCode || "000000",
      sellingPrice: c.sellingPrice,
      mrp: c.mrp || "0",
      discountType,
      discountValue,
      minOrderQty: "1",
      currentStock: "0",
      minStockQty: "0",
      reorderLevel: "1",
      // Unused once variants exist — see VariantRow.loyaltyPoints, the
      // per-variant equivalent that's actually read for a variant product.
      loyaltyPoints: "0",
      height: "",
      breadth: "",
      length: "",
      weight: sample?.weight ?? "",
      // No per-variant-product base shipping choice anymore — every
      // variant carries its own (see VariantRow.shippingCalcMode). This
      // base row's own value is never read for anything meaningful once
      // variants exist; kept as a harmless, valid default only because
      // the field itself is still required by the schema.
      shippingCalcMode: "INCLUDE_WITH_PRODUCT",
      // Same reasoning — every variant carries its own taxCalcMode instead.
      taxCalcMode: "INCLUDE_WITH_PRICE",
      // Card-display only — a variant product's base config is never priced
      // via net payable (the variants are), so this stays blank and the
      // server's net-payable conversion skips it.
      netPayableAmount: "",
    };
  }

  /**
   * The variant selling-price span the product card falls back to when the
   * "Display on product card" price is left blank — shown as a hint there
   * so the seller can see what "blank" resolves to.
   */
  function variantPriceHint(variants: VariantRow[]): string | null {
    const prices = variants
      .map((v) => Number(v.sellingPrice))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `₹${min.toFixed(2)}` : `₹${min.toFixed(2)} – ₹${max.toFixed(2)}`;
  }

  function toVariantInput(v: VariantRow) {
    const { discountType, discountValue } = sellingPriceToDiscount(
      Number(v.mrp) || 0,
      Number(v.sellingPrice) || 0,
    );
    const npa =
      priceEntryMode === "NET_PAYABLE" && v.netPayableAmount.trim()
        ? Number(v.netPayableAmount)
        : undefined;
    return {
      id: v.id,
      // Submit-time safety net on top of the pruning effect above (which
      // keeps attributeValueRefs in sync as attributeValues changes) — a
      // ref pointing at an (attributeId, slug) the CURRENT attributeValues
      // no longer has must never reach the server, since the server would
      // otherwise reject the whole save with an opaque
      // "attribute value that wasn't submitted" error instead of just
      // quietly dropping the one stale reference.
      attributeValueRefs: v.attributeValueRefs.filter((ref) =>
        attributeValueKeys.has(attributeValueKey(ref.attributeId, ref.slug)),
      ),
      sku: v.sku,
      hsnCode,
      mrp: v.mrp,
      discountType: npa != null ? "NONE" : discountType,
      discountValue: npa != null ? "0" : discountValue,
      netPayableAmount: npa,
      minOrderQty: v.minOrderQty,
      stockQty: v.stockQty,
      minStockQty: v.minStockQty,
      reorderLevel: v.reorderLevel,
      loyaltyPoints: v.loyaltyPoints ? Number(v.loyaltyPoints) : undefined,
      height: v.height || undefined,
      breadth: v.breadth || undefined,
      length: v.length || undefined,
      weight: v.weight || undefined,
      // Per-variant now — see VariantRow.shippingCalcMode's doc comment.
      shippingCalcMode: v.shippingCalcMode,
      taxCalcMode: v.taxCalcMode,
      imageUrl: v.imageUrl || undefined,
      imageAlt: v.imageAlt || undefined,
      images: v.images
        .filter((img) => img.url.trim())
        .map((img) => ({
          id: img.id,
          url: img.url,
          altText: img.altText || undefined,
          position: img.position,
          isActive: img.isActive,
        })),
      videoUrl: v.videoUrl || undefined,
      isActive: v.isActive,
    };
  }

  /** The product's own primary image + carousel gallery all live in one `base` folder — see catalogImagePaths.productBase's doc comment. */
  async function handleProductImageUpload(file: File): Promise<ImageUploadResult> {
    if (!onUploadProductImage) return { ok: false, error: "Upload is not available here." };
    const id = productId ?? pendingProductId ?? crypto.randomUUID();
    if (!productId && !pendingProductId) setPendingProductId(id);
    return onUploadProductImage(id, slug || "product", file);
  }

  async function handleVariantImageUpload(
    variantId: string,
    variantSlug: string,
    file: File,
  ): Promise<ImageUploadResult> {
    if (!onUploadVariantImage) return { ok: false, error: "Upload is not available here." };
    const id = productId ?? pendingProductId ?? crypto.randomUUID();
    if (!productId && !pendingProductId) setPendingProductId(id);
    return onUploadVariantImage(id, slug || "product", variantId, variantSlug, file);
  }

  function buildSubmission(): ProductSubmissionRawInput {
    return {
      ...(!productId && pendingProductId ? { id: pendingProductId } : {}),
      name,
      slug,
      sku,
      hsnCode,
      taxPercent: taxPercent ? Number(taxPercent) : undefined,
      priceEntryMode,
      shortDescription,
      description,
      ingredients: ingredients || undefined,
      howToUse: howToUse || undefined,
      dosageInstructions: dosageInstructions || undefined,
      technicalInfo: technicalInfo || undefined,
      // All four non-English languages are always sent (even when blank) so
      // the server removes a translation the seller cleared; an untouched
      // one is re-sent from state intact. Server sanitizes + drops
      // all-empty languages (see applyProductSubmission).
      translations: NON_ENGLISH_LANGUAGES.map((lang) => ({
        language: lang,
        name: translations[lang].name || undefined,
        shortDescription: translations[lang].shortDescription || undefined,
        description: translations[lang].description || undefined,
        ingredients: translations[lang].ingredients || undefined,
        howToUse: translations[lang].howToUse || undefined,
        dosageInstructions: translations[lang].dosageInstructions || undefined,
        technicalInfo: translations[lang].technicalInfo || undefined,
      })),
      productType,
      baseUnit,
      packageSize,
      searchTags: searchTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      featuredPosition: featuredPosition ? Number(featuredPosition) : undefined,
      categoryId,
      subCategoryId: subCategoryId || undefined,
      subSubCategoryId: subSubCategoryId || undefined,
      brandId: brandId || undefined,
      manufacturerId: manufacturerId || undefined,
      audience,
      customerVisible,
      dealerVisible,
      customerConfig: needsCustomer
        ? toConfigInput(hasVariants ? variantBaseConfig(customerConfig, customerVariants) : customerConfig)
        : undefined,
      dealerConfig: needsDealer
        ? toConfigInput(hasVariants ? variantBaseConfig(dealerConfig, dealerVariants) : dealerConfig)
        : undefined,
      attributeValues: attributeValues.map((v) => ({
        id: v.id,
        attributeId: v.attributeId,
        value: v.value,
        slug: v.slug,
        position: v.position,
        isActive: v.isActive,
      })),
      customerVariants: needsCustomer ? customerVariants.map(toVariantInput) : [],
      dealerVariants: needsDealer ? dealerVariants.map(toVariantInput) : [],
      customerStateIds,
      dealerStateIds,
      cropIds,
      pestDiseaseIds,
      primaryImageUrl,
      videoUrl: videoUrl || undefined,
      images: images
        .filter((img) => img.url.trim())
        .map((img) => ({
          id: img.id,
          url: img.url,
          altText: img.altText || undefined,
          position: img.position,
          isActive: img.isActive,
        })),
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
      metaImageUrl: metaImageUrl || undefined,
      subtitle: subtitle || undefined,
      editorialBadgeId: editorialBadgeId || undefined,
      deliveryBadgeEnabled,
      deliveryBadgeText: deliveryBadgeText || undefined,
      availabilityBadgeMode,
      availabilityBadgeText: availabilityBadgeText || undefined,
    };
  }

  /**
   * The product can be saved at any point with most fields empty — the
   * only thing ever required to save is a name (see
   * productDraftSubmissionSchema in packages/validators/src/catalog.ts and
   * saveProductDraft in packages/catalog/src/product-draft.ts, which fill
   * in safe placeholders for everything else so the save always succeeds).
   * Full correctness (real category, descriptions, pricing, primary image,
   * ...) is only required once, at "Submit for approval" time — see
   * assertProductComplete in packages/catalog/src/product-decisions.ts —
   * not on every intermediate save.
   *
   * Format checks that WOULD reject nonsense even in a draft (a malformed
   * SKU suffix, say) are still worth flagging early here rather than
   * waiting on a server round-trip, but only for fields the seller has
   * actually filled in — never for ones left blank.
   */
  function validate(): FormErrors {
    const errors: FormErrors = {};
    if (!name.trim()) errors.name = "Product name is required.";
    if (needsCustomer && customerConfig.sku.trim()) {
      const result = normalizeAudienceSku(customerConfig.sku, "CUSTOMER");
      if (!result.ok) errors["customerConfig.sku"] = result.error;
    }
    if (needsDealer && dealerConfig.sku.trim()) {
      const result = normalizeAudienceSku(dealerConfig.sku, "DEALER");
      if (!result.ok) errors["dealerConfig.sku"] = result.error;
    }
    if (hasVariants) {
      for (const [key, variants, variantAudience] of [
        ["customerVariants", customerVariants, "CUSTOMER"],
        ["dealerVariants", dealerVariants, "DEALER"],
      ] as const) {
        variants.forEach((variant, index) => {
          if (!variant.isActive || !variant.sku.trim()) return;
          const result = normalizeAudienceSku(variant.sku, variantAudience);
          if (!result.ok) errors[`${key}.${index}.sku`] = result.error;
        });
      }
    }
    return errors;
  }

  /**
   * The real, full field-completeness check — everything `validate()` used
   * to require before the draft-save relaxation. Only run when the seller
   * clicks "Submit for approval" (never for a plain Save), so this is
   * client-side pre-flight for the exact same rule the server enforces at
   * that point (assertProductComplete in
   * packages/catalog/src/product-decisions.ts) — a fast, specific "what's
   * missing" summary instead of a generic server rejection, not the source
   * of truth.
   */
  function validateForSubmission(): FormErrors {
    const errors: FormErrors = {};
    if (!name.trim()) errors.name = "Product name is required.";
    if (!hsnCode.trim()) errors.hsnCode = "HSN code is required.";
    if (!hasVariants && !packageSize.trim()) errors.packageSize = "Package size is required.";
    if (!categoryId) errors.categoryId = "Select a category.";
    if (isRichTextEmpty(shortDescription))
      errors.shortDescription = "Short description is required.";
    if (isRichTextEmpty(description)) errors.description = "Full description is required.";
    if (!primaryImageUrl.trim()) errors.primaryImageUrl = "Primary image URL is required.";

    const customerHasPricedVariant = customerVariants.some(
      (v) => v.isActive && Number(v.mrp) > 0,
    );
    const dealerHasPricedVariant = dealerVariants.some(
      (v) => v.isActive && Number(v.mrp) > 0,
    );
    if (needsCustomer && !hasVariants && (!customerConfig.mrp || Number(customerConfig.mrp) <= 0))
      errors["customerConfig.mrp"] = "Enter a customer MRP greater than 0.";
    if (needsCustomer && hasVariants && !customerHasPricedVariant)
      errors.customerVariants = "Add at least one priced, active customer variant.";
    if (needsDealer && !hasVariants && (!dealerConfig.mrp || Number(dealerConfig.mrp) <= 0))
      errors["dealerConfig.mrp"] = "Enter a dealer MRP greater than 0.";
    if (needsDealer && hasVariants && !dealerHasPricedVariant)
      errors.dealerVariants = "Add at least one priced, active dealer variant.";
    if (needsCustomer && !hasVariants) {
      const result = normalizeAudienceSku(customerConfig.sku, "CUSTOMER");
      if (!result.ok) errors["customerConfig.sku"] = result.error;
    }
    if (needsDealer && !hasVariants) {
      const result = normalizeAudienceSku(dealerConfig.sku, "DEALER");
      if (!result.ok) errors["dealerConfig.sku"] = result.error;
    }
    if (hasVariants) {
      for (const [key, variants, variantAudience] of [
        ["customerVariants", customerVariants, "CUSTOMER"],
        ["dealerVariants", dealerVariants, "DEALER"],
      ] as const) {
        variants.forEach((variant, index) => {
          if (!variant.isActive) return;
          const result = normalizeAudienceSku(variant.sku, variantAudience);
          if (!result.ok) errors[`${key}.${index}.sku`] = result.error;
        });
      }
    }

    // Net-payable mode: every active unit needs a net payable + weight, and
    // the derived selling price must sit at or below MRP. Mirrors the
    // strict server check in @kisan4u/orders applyNetPayablePricing.
    if (priceEntryMode === "NET_PAYABLE") {
      for (const row of netPayableSummaryRows) {
        if (!row.active) continue;
        const errKey =
          row.audience === "Customer"
            ? hasVariants
              ? "customerVariants"
              : "customerConfig.netPayableAmount"
            : hasVariants
              ? "dealerVariants"
              : "dealerConfig.netPayableAmount";
        const d = row.derived;
        if (!d || !d.ready) {
          errors[errKey] = `${row.label}: enter its MRP, net payable amount and a weight.`;
        } else if (d.overMrp) {
          errors[errKey] =
            `${row.label}: the net payable is too high — it implies a selling price of ₹${d.sellingPrice.toFixed(
              2,
            )}, above MRP. Reduce it to at most ₹${d.maxNetPayable.toFixed(2)}.`;
        }
      }
    }

    return errors;
  }

  function jumpToField(key: string) {
    const el = document.getElementById(key);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  }

  function sectionErrorCount(sectionId: SectionId): number {
    return Object.keys(fieldErrors).filter((key) => errorSection(key) === sectionId).length;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errors = requireFullValidationOnSave ? validateForSubmission() : validate();
    setFieldErrors(errors);
    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      jumpToField(firstKey);
      return;
    }
    startTransition(async () => {
      const submission = buildSubmission();
      const result = await onSave(submission);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${redirectBasePath}/${result.productId}`);
      router.refresh();
    });
  }

  /**
   * Save + submit for approval in one click — runs the full
   * validateForSubmission() check first (every mandatory field, not just
   * the name), then saves and immediately transitions the product to
   * SUBMITTED via onSubmitForApproval. Absent (admin editing an
   * already-reviewed product, or any context with no submit flow) hides
   * the button entirely — see the Review & submit section below.
   */
  function handleSubmitForApproval() {
    if (!onSubmitForApproval) return;
    setError(null);
    const errors = validateForSubmission();
    setFieldErrors(errors);
    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      jumpToField(firstKey);
      return;
    }
    startTransition(async () => {
      const submission = buildSubmission();
      const saveResult = await onSave(submission);
      if (!saveResult.ok) {
        setError(saveResult.error);
        return;
      }
      const submitResult = await onSubmitForApproval(saveResult.productId);
      if (!submitResult.ok) {
        setError(submitResult.error);
        router.refresh();
        return;
      }
      router.push(`${redirectBasePath}/${saveResult.productId}`);
      router.refresh();
    });
  }

  const errorCounts = Object.fromEntries(
    SECTIONS.map((s) => [s.id, sectionErrorCount(s.id)]),
  ) as Record<SectionId, number>;
  const errorEntries = Object.entries(fieldErrors);

  return (
    <form onSubmit={handleSave} noValidate className="pb-16">
      {errorEntries.length > 0 && (
        <div className="mb-6">
          <AlertBox
            tone="danger"
            title={`${errorEntries.length} field${errorEntries.length === 1 ? "" : "s"} need${errorEntries.length === 1 ? "s" : ""} attention`}
          >
            <ul className="mt-1 flex flex-col gap-1">
              {errorEntries.map(([key, message]) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => jumpToField(key)}
                    className="text-left underline decoration-danger/40 underline-offset-2 hover:decoration-danger"
                  >
                    {message}
                  </button>
                </li>
              ))}
            </ul>
          </AlertBox>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <SectionNav errorCounts={errorCounts} />

        <div className="flex flex-col gap-6">
          <FormSection id="basic" title="Basic information" errorCount={errorCounts.basic}>
            <FormSelect
              label="Does this product have variants?"
              hint="Asked upfront — a variant product manages pricing/inventory per variant in Attributes & variants below instead of the base Pricing/Inventory/Package size fields; a non-variant product never shows that editor."
              value={hasVariants ? "YES" : "NO"}
              onChange={(e) => handleHasVariantsChange(e.target.value === "YES")}
            >
              <option value="NO">No — a single sellable product</option>
              <option value="YES">Yes — multiple variants (e.g. Size, Colour)</option>
            </FormSelect>
            {hasVariantsSwitchWarning && (
              <AlertBox tone="warning">
                Switching to "No" will deactivate {customerVariants.length + dealerVariants.length}{" "}
                existing variant(s) on the next save (or drop them now if never saved) — they will
                no longer be purchasable.
                <div className="mt-2 flex gap-2">
                  <Button type="button" variant="danger" size="sm" onClick={() => applyHasVariantsChange(false)}>
                    Yes, remove variants
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setHasVariantsSwitchWarning(false)}>
                    Cancel
                  </Button>
                </div>
              </AlertBox>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormInput
                id="name"
                label="Product name"
                placeholder="e.g. Hybrid Tomato Seeds (Abhinav)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={fieldErrors.name}
                required
              />
              <FormInput
                id="slug"
                label="Slug"
                placeholder="URL name, e.g. hybrid-tomato-seeds-abhinav"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                error={fieldErrors.slug}
                required
              />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-dashboard p-3">
              <span className="text-[12.5px] font-semibold text-gray-600">
                Product name in other languages{" "}
                <span className="font-normal text-gray-400">
                  — optional; each falls back to the English name above on the storefront
                </span>
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {NON_ENGLISH_LANGUAGES.map((lang) => (
                  <FormInput
                    key={`name-${lang}`}
                    label={`Name in ${languageMeta(lang).label} (${languageMeta(lang).nativeLabel})`}
                    placeholder={name || "Same as English"}
                    value={translations[lang].name}
                    onChange={(e) =>
                      setTranslations((prev) => ({
                        ...prev,
                        [lang]: { ...prev[lang], name: e.target.value },
                      }))
                    }
                  />
                ))}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <FormInput
                id="sku"
                label="SKU"
                placeholder="Stock code, e.g. TOMATO-SEED-ABHINAV"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                error={fieldErrors.sku}
                required
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={() => generateSku(slug, setSku)}>
                Generate
              </Button>
            </div>
            <FormInput
              id="hsnCode"
              label="HSN code"
              placeholder="Tax classification code, e.g. 31051000"
              value={hsnCode}
              onChange={(e) => setHsnCode(e.target.value)}
              error={fieldErrors.hsnCode}
              required
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormSelect
                label="Product type"
                value={productType}
                onChange={(e) => setProductType(e.target.value as typeof productType)}
              >
                <option value="PHYSICAL">Physical</option>
                <option value="DIGITAL">Digital</option>
              </FormSelect>
              <FormSelect
                label="Base unit"
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value as typeof baseUnit)}
              >
                <option value="G">g</option>
                <option value="KG">kg</option>
                <option value="ML">ml</option>
                <option value="L">L</option>
                <option value="PIECE">piece</option>
              </FormSelect>
              {/* A variant product has no single package size — each variant is its own sellable unit, with nowhere in the schema to hang one shared value. */}
              {!hasVariants && (
                <FormInput
                  id="packageSize"
                  label="Package size"
                  placeholder="e.g. 500 ml"
                  value={packageSize}
                  onChange={(e) => setPackageSize(e.target.value)}
                  error={fieldErrors.packageSize}
                  required
                />
              )}
            </div>
            <FormInput
              label="Search tags"
              hint="Comma separated"
              placeholder="e.g. tomato, hybrid seeds, kharif, high yield"
              value={searchTags}
              onChange={(e) => setSearchTags(e.target.value)}
            />
            <FormInput
              label="Featured position"
              hint={isAdmin ? "Optional" : "Admin-only"}
              type="number"
              placeholder="Lower shows first on the homepage, e.g. 1"
              value={featuredPosition}
              onChange={(e) => setFeaturedPosition(e.target.value)}
              disabled={!isAdmin}
            />
          </FormSection>

          <FormSection
            id="classification"
            title="Category, brand & classification"
            errorCount={errorCounts.classification}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormSelect
                id="categoryId"
                label="Category"
                value={categoryId}
                error={fieldErrors.categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubCategoryId("");
                  setSubSubCategoryId("");
                }}
              >
                {reference.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Subcategory"
                value={subCategoryId}
                onChange={(e) => {
                  setSubCategoryId(e.target.value);
                  setSubSubCategoryId("");
                }}
              >
                <option value="">— No subcategory —</option>
                {subcategoryOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Sub-subcategory"
                value={subSubCategoryId}
                onChange={(e) => setSubSubCategoryId(e.target.value)}
              >
                <option value="">— No sub-subcategory —</option>
                {subSubCategoryOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </FormSelect>
            </div>
            {sellerId && eligibility && eligibility.requirements.length > 0 && (
              <AlertBox
                tone={
                  eligibility.customer.eligibleStateIds.length === 0 &&
                  eligibility.dealer.eligibleStateIds.length === 0
                    ? "danger"
                    : "info"
                }
              >
                This category path requires {eligibility.requirements.length} selling licence
                {eligibility.requirements.length === 1 ? "" : "s"}. Customer:{" "}
                {eligibility.customer.eligibleStateIds.length === 0
                  ? "blocked — you do not have all the required approved selling licences."
                  : eligibility.customer.isPanIndia
                    ? "approved for all states."
                    : `approved for ${eligibility.customer.eligibleStateIds.length} state(s).`}{" "}
                Dealer:{" "}
                {eligibility.dealer.eligibleStateIds.length === 0
                  ? "blocked — you do not have all the required approved selling licences."
                  : eligibility.dealer.isPanIndia
                    ? "approved for all states."
                    : `approved for ${eligibility.dealer.eligibleStateIds.length} state(s).`}{" "}
                See the Customer &amp; Dealer Audience section below for full details and a "View
                required licences" list.
              </AlertBox>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormSelect
                label="Brand"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
              >
                <option value="">— No brand —</option>
                {reference.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Manufacturer"
                value={manufacturerId}
                onChange={(e) => setManufacturerId(e.target.value)}
              >
                <option value="">— No manufacturer —</option>
                {reference.manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </FormSelect>
            </div>

            <div className="mt-4 flex flex-col gap-5 border-t border-border pt-4">
              <TagMultiSelect
                label="Crops"
                hint="Tag the crops this product is for — powers the homepage “Shop by Crop” strip and each crop's page."
                emptyHint="No crops have been added yet. An admin can add them under Catalog → Crops."
                options={reference.crops}
                value={cropIds}
                onChange={setCropIds}
              />
              <TagMultiSelect
                label="Pests & diseases"
                hint="Tag the pests or diseases this product treats — powers the homepage “Shop by Pest & Disease” strip and each entry's page."
                emptyHint="No pests or diseases have been added yet. An admin can add them under Catalog → Pests & Diseases."
                options={reference.pestsDiseases}
                value={pestDiseaseIds}
                onChange={setPestDiseaseIds}
              />
            </div>
          </FormSection>

          <FormSection
            id="audience"
            title="Customer & dealer audience"
            errorCount={errorCounts.audience}
          >
            <FormSelect
              label="Audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as typeof audience)}
            >
              <option value="CUSTOMER_ONLY" disabled={!customerAudienceEnabled}>
                Customer only{!customerAudienceEnabled ? " (no licensed state available)" : ""}
              </option>
              <option value="DEALER_ONLY" disabled={!dealerAudienceEnabled}>
                Dealer only{!dealerAudienceEnabled ? " (no licensed state available)" : ""}
              </option>
              <option
                value="BOTH_CUSTOMER_AND_DEALER"
                disabled={!customerAudienceEnabled || !dealerAudienceEnabled}
              >
                Customer and Dealer
                {!customerAudienceEnabled || !dealerAudienceEnabled
                  ? " (no licensed state available for one audience)"
                  : ""}
              </option>
            </FormSelect>
            {/* Licence requirements are now derived automatically from the selected taxonomy — sellers never decide whether a product needs one (spec §6). */}
            <div className="flex flex-col gap-2">
              {needsCustomer && (
                <CheckboxField checked={customerVisible} onChange={setCustomerVisible}>
                  Visible to customers
                </CheckboxField>
              )}
              {needsDealer && (
                <CheckboxField checked={dealerVisible} onChange={setDealerVisible}>
                  Visible to dealers
                </CheckboxField>
              )}
            </div>
            {needsCustomer && (
              <div className="border-t border-border pt-4">
                <LicenceStatesSelector
                  audienceLabel="Customer state availability"
                  audience="customer"
                  states={reference.states}
                  value={customerStateIds}
                  onChange={setCustomerStateIds}
                  eligibility={eligibility}
                />
              </div>
            )}
            {needsDealer && (
              <div className="border-t border-border pt-4">
                <LicenceStatesSelector
                  audienceLabel="Dealer state availability"
                  audience="dealer"
                  states={reference.states}
                  value={dealerStateIds}
                  onChange={setDealerStateIds}
                  eligibility={eligibility}
                />
              </div>
            )}
          </FormSection>

          <FormSection id="description" title="Description" errorCount={errorCounts.description}>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-gray-600">Language</span>
              <LanguageTabs
                options={descLangOptions}
                value={descLang}
                onChange={setDescLang}
              />
              <p className="text-xs text-gray-500">
                {descIsEnglish
                  ? "English is the default. Fill in the other languages below — a storefront visitor who picks that language sees this text instead."
                  : `Editing the ${languageMeta(descLang).label} version. Any field left blank falls back to the English text on the storefront.`}
              </p>
            </div>
            <FormField
              label="Short description"
              required={descIsEnglish}
              error={descIsEnglish ? fieldErrors.shortDescription : undefined}
            >
              <RichTextEditor
                key={`shortDescription-${descLang}`}
                id={descIsEnglish ? "shortDescription" : undefined}
                value={descValues.shortDescription}
                onChange={(v) => setDescField("shortDescription", v)}
                onUploadImage={handleProductImageUpload}
                placeholder="A one or two sentence summary shown near the top of the product page…"
                error={descIsEnglish ? fieldErrors.shortDescription : undefined}
              />
            </FormField>
            <FormField
              label="Full description"
              required={descIsEnglish}
              error={descIsEnglish ? fieldErrors.description : undefined}
            >
              <RichTextEditor
                key={`description-${descLang}`}
                id={descIsEnglish ? "description" : undefined}
                value={descValues.description}
                onChange={(v) => setDescField("description", v)}
                onUploadImage={handleProductImageUpload}
                placeholder="The full product description…"
                error={descIsEnglish ? fieldErrors.description : undefined}
              />
            </FormField>
            <FormField label="Ingredients / composition" hint="Optional">
              <RichTextEditor
                key={`ingredients-${descLang}`}
                value={descValues.ingredients}
                onChange={(v) => setDescField("ingredients", v)}
                onUploadImage={handleProductImageUpload}
                placeholder="Active ingredients and their concentration, e.g. Imidacloprid 17.8% SL…"
              />
            </FormField>
            <FormField label="How to use" hint="Optional">
              <RichTextEditor
                key={`howToUse-${descLang}`}
                value={descValues.howToUse}
                onChange={(v) => setDescField("howToUse", v)}
                onUploadImage={handleProductImageUpload}
                placeholder="Step-by-step application method, timing and precautions…"
              />
            </FormField>
            <FormField label="Dosage / instructions" hint="Optional">
              <RichTextEditor
                key={`dosageInstructions-${descLang}`}
                value={descValues.dosageInstructions}
                onChange={(v) => setDescField("dosageInstructions", v)}
                onUploadImage={handleProductImageUpload}
                placeholder="Recommended dose per acre / per litre of water, and crop stage…"
              />
            </FormField>
            <FormField label="Technical information" hint="Optional">
              <RichTextEditor
                key={`technicalInfo-${descLang}`}
                value={descValues.technicalInfo}
                onChange={(v) => setDescField("technicalInfo", v)}
                onUploadImage={handleProductImageUpload}
                placeholder="Chemical family, mode of action, target pests / crops, shelf life…"
              />
            </FormField>
          </FormSection>

          <FormSection
            id="attributes"
            title="Attributes & variants"
            description='Governed by "Does this product have variants?" in Basic information above.'
            errorCount={errorCounts.attributes}
          >
            {hasVariants ? (
              <>
                <AttributeValuesEditor
                  attributes={reference.attributes}
                  values={attributeValues}
                  onChange={setAttributeValues}
                  onRemove={onRemoveAttributeValue}
                />
                {needsCustomer && (
                  <VariantsEditor
                    label="Customer variants"
                    audience="CUSTOMER"
                    attributes={reference.attributes}
                    attributeValues={attributeValues}
                    variants={customerVariants}
                    onChange={setCustomerVariants}
                    onRemove={onRemoveVariant}
                    onSetDefault={onSetDefaultVariant}
                    logisticsConfig={reference.logisticsConfig}
                    onUploadVariantImage={handleVariantImageUpload}
                    resolveDisplaySrc={displaySrc}
                    priceEntryMode={priceEntryMode}
                    taxPercent={taxPercentNumber}
                    npRates={customerNpRates}
                  />
                )}
                {needsDealer && (
                  <VariantsEditor
                    label="Dealer variants"
                    audience="DEALER"
                    attributes={reference.attributes}
                    attributeValues={attributeValues}
                    variants={dealerVariants}
                    onChange={setDealerVariants}
                    onRemove={onRemoveVariant}
                    onSetDefault={onSetDefaultVariant}
                    logisticsConfig={reference.logisticsConfig}
                    onUploadVariantImage={handleVariantImageUpload}
                    resolveDisplaySrc={displaySrc}
                    priceEntryMode={priceEntryMode}
                    taxPercent={taxPercentNumber}
                    npRates={dealerNpRates}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Not applicable — set "Does this product have variants?" above to Yes to add
                attributes/variants.
              </p>
            )}
          </FormSection>

          <FormSection
            id="cardPricing"
            title="Display on product card"
            description="A variant product has no single price — this is the MRP/selling price shown on the product listing card and search results, independent of any specific variant. Leave blank and the card falls back to the default variant's own price instead."
            errorCount={errorCounts.cardPricing}
          >
            {!hasVariants ? (
              <p className="text-sm text-gray-500">
                Not applicable — a non-variant product's card price is just its own MRP/selling
                price, set in Pricing &amp; discounts below.
              </p>
            ) : !needsCustomer && !needsDealer ? (
              <p className="text-sm text-gray-500">
                Select a customer/dealer audience above to configure the card price.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {needsCustomer && (
                  <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
                    <h3 className="text-[13px] font-bold text-ink">Customer</h3>
                    <FormInput
                      label="MRP"
                      type="number"
                      placeholder="Optional — card MRP, e.g. 250"
                      value={customerConfig.mrp}
                      onChange={(e) => setCustomerConfig((c) => ({ ...c, mrp: e.target.value }))}
                    />
                    <FormInput
                      label="Selling price"
                      type="number"
                      placeholder="Optional — card price, e.g. 210"
                      value={customerConfig.sellingPrice}
                      onChange={(e) =>
                        setCustomerConfig((c) => ({ ...c, sellingPrice: e.target.value }))
                      }
                    />
                    {variantPriceHint(customerVariants) && (
                      <p className="text-[12px] text-gray-500">
                        Left blank, the card shows the customer variant price:{" "}
                        <strong className="text-ink">{variantPriceHint(customerVariants)}</strong>
                      </p>
                    )}
                  </div>
                )}
                {needsDealer && (
                  <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
                    <h3 className="text-[13px] font-bold text-ink">Dealer</h3>
                    <FormInput
                      label="MRP"
                      type="number"
                      placeholder="Optional — card MRP, e.g. 250"
                      value={dealerConfig.mrp}
                      onChange={(e) => setDealerConfig((c) => ({ ...c, mrp: e.target.value }))}
                    />
                    <FormInput
                      label="Selling price"
                      type="number"
                      placeholder="Optional — card price, e.g. 195"
                      value={dealerConfig.sellingPrice}
                      onChange={(e) =>
                        setDealerConfig((c) => ({ ...c, sellingPrice: e.target.value }))
                      }
                    />
                    {variantPriceHint(dealerVariants) && (
                      <p className="text-[12px] text-gray-500">
                        Left blank, the card shows the dealer variant price:{" "}
                        <strong className="text-ink">{variantPriceHint(dealerVariants)}</strong>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </FormSection>

          <FormSection id="pricing" title="Pricing & discounts" errorCount={errorCounts.pricing}>
            {!needsCustomer && !needsDealer ? (
              <p className="text-sm text-gray-500">
                Select a customer/dealer audience above to configure pricing.
              </p>
            ) : (
              <>
                <FormInput
                  id="taxPercent"
                  label="Tax rate (%)"
                  hint="Applies to every audience and variant of this product."
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="GST %, e.g. 5, 12 or 18"
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                  error={fieldErrors.taxPercent}
                  className="max-w-[200px]"
                />

                <div className="rounded-lg border border-border p-3">
                  <p className="text-[13px] font-bold text-ink">How do you want to enter prices?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        ["SELLING_PRICE", "Selling price / MRP + discount"],
                        ["NET_PAYABLE", "Net payable amount"],
                      ] as const
                    ).map(([mode, text]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPriceEntryMode(mode)}
                        className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                          priceEntryMode === mode
                            ? "border-green-600 bg-green-50 text-green-800"
                            : "border-border bg-white text-gray-600 hover:border-gray-400"
                        }`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  {priceEntryMode === "NET_PAYABLE" && (
                    <p className="mt-2 text-[12px] text-gray-500">
                      Enter what you want to receive per unit after Kisan4U&apos;s settlement
                      deductions (commission, logistics, collection charge, their taxes, TCS/TDS). The
                      selling price is worked out from it, per audience. It assumes the unit ships on
                      its own, so the real payout shifts a little once it&apos;s delivered alongside
                      other items, and a weight is required for every unit.
                      {!reference.settlementPricing &&
                        " Settlement rates aren't available here, so the selling price is only computed on save."}
                    </p>
                  )}
                </div>

                {hasVariants ? (
                  <p className="text-sm text-gray-500">
                    MRP, discount, and {priceEntryMode === "NET_PAYABLE" ? "net payable" : "selling"}{" "}
                    price are set per variant in Attributes &amp; variants above — not applicable
                    here.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {needsCustomer && (
                      <PricingFields
                        idPrefix="customerConfig"
                        label="Customer pricing"
                        audience="CUSTOMER"
                        baseSku={sku}
                        value={customerConfig}
                        onChange={setCustomerConfig}
                        errors={fieldErrors}
                        priceEntryMode={priceEntryMode}
                        taxPercent={taxPercentNumber}
                        npRates={customerNpRates}
                        logisticsConfig={reference.logisticsConfig}
                      />
                    )}
                    {needsDealer && (
                      <PricingFields
                        idPrefix="dealerConfig"
                        label="Dealer pricing"
                        audience="DEALER"
                        baseSku={sku}
                        value={dealerConfig}
                        onChange={setDealerConfig}
                        errors={fieldErrors}
                        priceEntryMode={priceEntryMode}
                        taxPercent={taxPercentNumber}
                        npRates={dealerNpRates}
                        logisticsConfig={reference.logisticsConfig}
                      />
                    )}
                  </div>
                )}

                {priceEntryMode === "NET_PAYABLE" && <NetPayableSummary rows={netPayableSummaryRows} />}
              </>
            )}
          </FormSection>

          <FormSection
            id="inventory"
            title="Inventory & availability"
            errorCount={errorCounts.inventory}
          >
            {!needsCustomer && !needsDealer ? (
              <p className="text-sm text-gray-500">
                Select a customer/dealer audience above to configure inventory.
              </p>
            ) : hasVariants ? (
              <p className="text-sm text-gray-500">
                Not applicable — stock, minimum quantity, reorder level, and loyalty points are
                tracked per variant in Attributes &amp; variants above.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {needsCustomer && (
                  <InventoryFields
                    label="Customer inventory"
                    audience="CUSTOMER"
                    value={customerConfig}
                    onChange={setCustomerConfig}
                    isEditing={!!productId}
                  />
                )}
                {needsDealer && (
                  <InventoryFields
                    label="Dealer inventory"
                    audience="DEALER"
                    value={dealerConfig}
                    onChange={setDealerConfig}
                    isEditing={!!productId}
                  />
                )}
              </div>
            )}
          </FormSection>

          <FormSection
            id="images"
            title="Images & media"
            description="Upload an image or paste a URL — either source works for the primary image and every carousel image below."
            errorCount={errorCounts.images}
          >
            <ImageUploadField
              label="Primary image"
              value={primaryImageUrl}
              onChange={setPrimaryImageUrl}
              onUpload={handleProductImageUpload}
              required
              resolveDisplaySrc={displaySrc}
            />
            {fieldErrors.primaryImageUrl && (
              <p className="text-[13px] font-medium text-danger">{fieldErrors.primaryImageUrl}</p>
            )}
            <div>
              <p className="mb-2 text-[13px] text-gray-500">
                Additional carousel images (reorder, activate/deactivate, or set one as the primary
                image above):
              </p>
              <ImagesEditor
                images={images}
                onChange={setImages}
                onSetPrimary={setPrimaryImageUrl}
                primaryImageUrl={primaryImageUrl}
                onUploadImage={handleProductImageUpload}
                resolveDisplaySrc={displaySrc}
              />
            </div>
            <FormInput
              label="Video URL"
              hint="Optional"
              placeholder="https://youtube.com/watch?v=…"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
          </FormSection>

          <FormSection id="shipping" title="Shipping & logistics" errorCount={errorCounts.shipping}>
            {!needsCustomer && !needsDealer ? (
              <p className="text-sm text-gray-500">
                Select a customer/dealer audience above to configure shipping.
              </p>
            ) : hasVariants ? (
              <p className="text-sm text-gray-500">
                Not applicable — weight, dimensions, and the shipping-inclusion choice are all set
                per variant in Attributes &amp; variants above (dealer shipping is always excluded
                there too, calculated separately).
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {needsCustomer && (
                  <ShippingFields
                    label="Customer shipping"
                    audience="CUSTOMER"
                    value={customerConfig}
                    onChange={setCustomerConfig}
                    logisticsConfig={reference.logisticsConfig}
                  />
                )}
                {needsDealer && (
                  <ShippingFields
                    label="Dealer shipping"
                    audience="DEALER"
                    value={dealerConfig}
                    onChange={setDealerConfig}
                    logisticsConfig={reference.logisticsConfig}
                  />
                )}
              </div>
            )}
          </FormSection>

          <FormSection
            id="badges"
            title="Badges & merchandising"
            description="Controls how this product's card renders on the storefront (Product Card Design Spec). Editorial badge, availability badge, delivery badge and featured position are admin-only."
            errorCount={errorCounts.badges}
          >
            <FormInput
              label="Subtitle"
              hint="One short line, shown below the title — optional"
              placeholder="e.g. High-yield hybrid, tolerant to leaf curl virus"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              maxLength={120}
            />
            {!isAdmin && (
              <p className="rounded-md bg-bg-dashboard px-3 py-2 text-[13px] text-gray-600">
                Editorial badge, availability badge, delivery badge and featured position are
                managed by an admin. The current values are shown below, locked.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormSelect
                label="Editorial badge"
                value={editorialBadgeId}
                onChange={(e) => setEditorialBadgeId(e.target.value)}
                disabled={!isAdmin}
              >
                <option value="">— None —</option>
                {reference.editorialBadges
                  .filter((b) => b.isActive || b.id === editorialBadgeId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {!b.isActive ? " (inactive)" : ""}
                    </option>
                  ))}
              </FormSelect>
              <FormSelect
                label="Availability badge"
                value={availabilityBadgeMode}
                onChange={(e) =>
                  setAvailabilityBadgeMode(e.target.value as typeof availabilityBadgeMode)
                }
                disabled={!isAdmin}
              >
                <option value="AUTOMATIC">Automatic (derived from stock/eligibility)</option>
                <option value="MANUAL">Manual (fixed text below)</option>
                <option value="OFF">Off (never show)</option>
              </FormSelect>
            </div>
            {availabilityBadgeMode === "MANUAL" && (
              <FormInput
                label="Availability badge text"
                placeholder="e.g. Only a few left"
                value={availabilityBadgeText}
                onChange={(e) => setAvailabilityBadgeText(e.target.value)}
                maxLength={40}
                disabled={!isAdmin}
              />
            )}
            <CheckboxField
              checked={deliveryBadgeEnabled}
              onChange={setDeliveryBadgeEnabled}
              disabled={!isAdmin}
            >
              Show a delivery badge (use only for an exceptional delivery promise, not normal
              delivery)
            </CheckboxField>
            {deliveryBadgeEnabled && (
              <FormInput
                label="Delivery badge text"
                hint="Leave blank to use the site default"
                placeholder="e.g. Delivered in 24 hours"
                value={deliveryBadgeText}
                onChange={(e) => setDeliveryBadgeText(e.target.value)}
                maxLength={40}
                disabled={!isAdmin}
              />
            )}
          </FormSection>

          <FormSection id="seo" title="SEO" errorCount={errorCounts.seo}>
            <FormInput
              label="Meta title"
              hint="Shown in search results — defaults to the product name if blank"
              placeholder="e.g. Buy Hybrid Tomato Seeds (Abhinav) online | Kisan4U"
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
            />
            <FormTextarea
              label="Meta description"
              hint="~150 characters — the grey text under the title in search results"
              placeholder="e.g. High-yield hybrid tomato seeds with leaf-curl-virus tolerance. Order online with fast farm delivery across India."
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              rows={2}
            />
            <FormInput
              label="Meta image URL"
              hint="Image used when the product is shared on social media"
              placeholder="https://…/tomato-seeds-share.jpg"
              value={metaImageUrl}
              onChange={(e) => setMetaImageUrl(e.target.value)}
            />
          </FormSection>

          <FormSection id="review" title="Review & submit" errorCount={errorCounts.review}>
            {error && (
              <AlertBox tone="danger" title="Couldn't save this product">
                {error}
              </AlertBox>
            )}
            {errorEntries.length === 0 && (
              <p className="text-[13px] text-gray-500">
                {onSubmitForApproval
                  ? 'This can be saved at any point, even with most fields still empty — only a product name is required. Use "Submit for approval" once every mandatory field is filled in.'
                  : "This can be saved at any point, even with most fields still empty — only a product name is required. Everything else (category, descriptions, pricing, primary image, ...) is only checked once you submit it for approval."}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary" loading={isPending} size="lg" className="w-fit">
                {submitLabel ?? "Save product"}
              </Button>
              {onSubmitForApproval && (
                <Button
                  type="button"
                  loading={isPending}
                  size="lg"
                  className="w-fit"
                  onClick={handleSubmitForApproval}
                >
                  Submit for approval
                </Button>
              )}
            </div>
          </FormSection>
        </div>
      </div>
    </form>
  );
}
