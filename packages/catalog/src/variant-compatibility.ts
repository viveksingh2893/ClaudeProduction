import { buildCombinationKey } from "./combination-key";

/**
 * Pure, framework-free variant-compatibility engine — no Prisma import, no
 * React, no fetch. Takes whatever variant shape the caller already queried
 * (see CUSTOMER_INCLUDE / DEALER_PRICED_VARIANT_SELECT in queries.ts, both of
 * which already nest `values.attributeValue.attribute`) mapped into
 * `CompatibilityVariant[]`, and answers three questions a variant selector
 * UI needs on every click: which values are still selectable, which single
 * SKU the current selection resolves to, and what to do when a new pick
 * invalidates an earlier one. Never hard-codes an attribute name or count —
 * every function derives its attribute/value universe from the variants it
 * was given, so it works identically for one attribute or five.
 */

export type VariantAttributeValueRef = {
  attributeId: string;
  attributeName: string;
  valueId: string;
  value: string;
};

export type CompatibilityVariant = {
  id: string;
  isActive: boolean;
  stockQty: number;
  attributeValues: VariantAttributeValueRef[];
};

export type AttributeOption = { valueId: string; value: string };
export type AttributeGroup = {
  attributeId: string;
  attributeName: string;
  options: AttributeOption[];
};

/** A partial or complete set of choices — one valueId per attributeId the shopper has picked so far. */
export type VariantSelection = Record<string, string>;

/**
 * Every distinct attribute represented across `variants`, each with its
 * distinct values — both in first-seen order, so the UI's attribute/value
 * ordering matches however the admin ordered them (ProductVariantAttributeValue.position
 * governs the order variants were fetched in upstream; this function just
 * preserves whatever order it's handed, it doesn't re-sort).
 */
export function getVariantAttributes(variants: CompatibilityVariant[]): AttributeGroup[] {
  const order: string[] = [];
  const groups = new Map<string, AttributeGroup>();
  for (const variant of variants) {
    for (const av of variant.attributeValues) {
      let group = groups.get(av.attributeId);
      if (!group) {
        group = { attributeId: av.attributeId, attributeName: av.attributeName, options: [] };
        groups.set(av.attributeId, group);
        order.push(av.attributeId);
      }
      if (!group.options.some((o) => o.valueId === av.valueId)) {
        group.options.push({ valueId: av.valueId, value: av.value });
      }
    }
  }
  return order.map((id) => groups.get(id)!);
}

export type ValueAvailability = AttributeOption & {
  available: boolean;
  /**
   * At least one active variant offers this value at all, in SOME
   * combination — ignores every other attribute's current selection
   * entirely (unlike `available`). This is what a selector UI should gate
   * `disabled` on: a value that's incompatible with what's *currently*
   * selected elsewhere (available=false) is still pickable — picking it is
   * exactly what applySelection's clear-and-reconcile step is for. Only a
   * value with NO active variant anywhere (reachable=false) is a true
   * dead end. Without this distinction, a sparse variant matrix with no
   * overlapping combinations (e.g. two SKUs "10g/1NOS" and "20g/100NOS")
   * disables every alternate value on every attribute simultaneously —
   * every button `available: false` at once — with no click path out.
   */
  reachable: boolean;
  inStock: boolean;
};

/**
 * For one attribute, whether each of its values is still a valid pick
 * given every OTHER attribute's current selection — ignores whatever is
 * currently selected for `attributeId` itself (the question being asked
 * is "if the shopper picked this instead, would it be compatible," not
 * "is what's already picked compatible with itself"). `available` = at
 * least one matching variant exists at all; `inStock` = at least one
 * matching variant additionally has stock — a genuinely valid combination
 * that happens to be sold out should stay visibly selectable-but-flagged,
 * never silently vanish (see the redesign brief: "disabled state with an
 * Unavailable indication rather than silently removing them"). See
 * `reachable`'s own doc comment for why a selector UI must gate its
 * disabled state on THAT field, not `available`.
 */
export function getAvailableValuesForAttribute(
  variants: CompatibilityVariant[],
  selection: VariantSelection,
  attributeId: string,
): ValueAvailability[] {
  const group = getVariantAttributes(variants).find((g) => g.attributeId === attributeId);
  if (!group) return [];
  const otherSelections = Object.entries(selection).filter(([attrId]) => attrId !== attributeId);

  return group.options.map(({ valueId, value }) => {
    const matchesCandidate = (v: CompatibilityVariant) =>
      v.attributeValues.some((av) => av.attributeId === attributeId && av.valueId === valueId);
    const matching = variants.filter((v) => {
      const matchesOthers = otherSelections.every(([attrId, valId]) =>
        v.attributeValues.some((av) => av.attributeId === attrId && av.valueId === valId),
      );
      return matchesOthers && matchesCandidate(v);
    });
    const globalMatching = variants.filter(matchesCandidate);
    return {
      valueId,
      value,
      available: matching.some((v) => v.isActive),
      reachable: globalMatching.some((v) => v.isActive),
      inStock: matching.some((v) => v.isActive && v.stockQty > 0),
    };
  });
}

/** True once every attribute the variant matrix defines has a selected value. */
export function isSelectionComplete(
  variants: CompatibilityVariant[],
  selection: VariantSelection,
): boolean {
  const attrs = getVariantAttributes(variants);
  return attrs.length > 0 && attrs.every((g) => !!selection[g.attributeId]);
}

/**
 * Resolves a complete selection to the one real variant it identifies —
 * returns null for an incomplete selection or one with no matching
 * variant (should not happen for a selection built only from
 * getAvailableValuesForAttribute's `available: true` options, but a
 * caller must never assume that without checking). Uses the SAME
 * deterministic sorted-id join (buildCombinationKey) the database itself
 * uses for ProductVariant.combinationKey — structural id matching, not a
 * hand-built label string, so it can never confuse two differently-cased
 * or differently-worded values that happen to render the same text.
 */
export function resolveVariant(
  variants: CompatibilityVariant[],
  selection: VariantSelection,
): CompatibilityVariant | null {
  const attrs = getVariantAttributes(variants);
  if (attrs.length === 0 || !isSelectionComplete(variants, selection)) return null;
  const targetKey = buildCombinationKey(attrs.map((g) => selection[g.attributeId]!));
  return (
    variants.find(
      (v) =>
        v.isActive && buildCombinationKey(v.attributeValues.map((av) => av.valueId)) === targetKey,
    ) ?? null
  );
}

export type ApplySelectionResult = {
  selection: VariantSelection;
  /** Attribute ids that were cleared because the new pick made their previous value incompatible — the caller should tell the shopper what changed (e.g. "Size reset because it's not available in Red"). */
  clearedAttributeIds: string[];
};

/**
 * THE entry point a variant-selector UI calls on every click: applies one
 * attribute change, then checks every OTHER already-selected attribute
 * against the resulting full context (reusing getAvailableValuesForAttribute,
 * not a second copy of the same matching logic) and clears only the ones
 * that are no longer valid — never resets the whole selection, and never
 * leaves a now-invalid value silently selected.
 */
export function applySelection(
  variants: CompatibilityVariant[],
  currentSelection: VariantSelection,
  changedAttributeId: string,
  newValueId: string,
): ApplySelectionResult {
  const next: VariantSelection = { ...currentSelection, [changedAttributeId]: newValueId };
  const clearedAttributeIds: string[] = [];
  for (const attrId of Object.keys(next)) {
    if (attrId === changedAttributeId) continue;
    const valueId = next[attrId]!;
    const stillAvailable =
      getAvailableValuesForAttribute(variants, next, attrId).find((o) => o.valueId === valueId)
        ?.available ?? false;
    if (!stillAvailable) {
      delete next[attrId];
      clearedAttributeIds.push(attrId);
    }
  }
  return { selection: next, clearedAttributeIds };
}

/**
 * The per-unit price shown next to a variant's selling price (e.g. "₹12.50
 * per unit") for a multi-piece pack — derived live from `sellingPrice` and
 * this variant's own "Case" attribute value (the global attribute seeded as
 * `{ name: "Case", slug: "case" }`, whose value is a leading piece count
 * like "50Nos" or "100NOS" — `parseInt` reads the leading digits and
 * ignores the unit suffix). Returns null when the variant has no "Case"
 * attribute value at all (a single-piece variant has no per-unit price to
 * show) or the count/price can't be parsed.
 *
 * Deliberately NOT a stored column: the previous `ProductVariant.perUnitMrp`
 * field was written once by the legacy-catalogue migration (case price ÷
 * case count, using MRP) and never again by the ordinary admin product
 * form, so it silently went stale/null for every product created since —
 * "wrong and inconsistent" per the product/admin report. Computing it live
 * from `sellingPrice` here instead means it's always in sync with the
 * actual selling price (post-discount, not MRP) everywhere it's shown,
 * and — since it's a pure function of data the admin form already has in
 * memory — it can also drive a live, non-editable per-unit-price readout
 * in the variant form as the seller types a new selling price.
 */
export function computeUnitPrice(
  sellingPrice: number | string | null | undefined,
  attributeValues: { attributeName: string; value: string }[],
): number | null {
  const caseAttr = attributeValues.find((a) => a.attributeName === "Case");
  if (!caseAttr) return null;
  const caseCount = parseInt(caseAttr.value, 10);
  if (!Number.isFinite(caseCount) || caseCount <= 0) return null;
  const price = typeof sellingPrice === "number" ? sellingPrice : parseFloat(String(sellingPrice ?? ""));
  if (!Number.isFinite(price) || price <= 0) return null;
  return price / caseCount;
}

/** A sensible starting selection: the product's marked default variant if it's active, else the first active variant, else none. Only pre-fills when there's exactly one unambiguous "obvious" starting point — never guesses across a genuinely open choice. */
export function getInitialSelection(
  variants: CompatibilityVariant[],
  defaultVariantId?: string | null,
): VariantSelection {
  const attrs = getVariantAttributes(variants);
  if (attrs.length === 0) return {};
  const start =
    (defaultVariantId ? variants.find((v) => v.id === defaultVariantId && v.isActive) : null) ??
    variants.find((v) => v.isActive);
  if (!start) return {};
  const selection: VariantSelection = {};
  for (const av of start.attributeValues) selection[av.attributeId] = av.valueId;
  return selection;
}
