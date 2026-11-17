import { buildCombinationKey } from "./combination-key";

/**
 * Mirrors packages/catalog/src/variant-compatibility.ts exactly (same
 * function names, same signatures, same behavior) — kept as a plain copy
 * rather than an `@kisan4u/catalog` runtime dependency, since that
 * package's barrel also re-exports Prisma-backed modules Metro/Hermes
 * can't bundle. If the web/catalog version changes, mirror the change
 * here. Both apps/mobile product screens (customer + dealer) share this
 * one module instead of each hand-rolling their own matching logic.
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

export type VariantSelection = Record<string, string>;

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

/**
 * `reachable` = at least one active variant offers this value at all, in
 * SOME combination — ignores every other attribute's current selection
 * (unlike `available`, which only checks compatibility with what's
 * CURRENTLY selected elsewhere). A selector UI must gate its disabled
 * state on `reachable`, not `available`: a value merely incompatible with
 * the current other selections is still pickable (picking it lets
 * applySelection clear the conflicting attribute); only a value with no
 * active variant anywhere is a true dead end. Without this distinction, a
 * sparse variant matrix with no overlapping combinations (e.g. two SKUs
 * "10g/1NOS" and "20g/100NOS") disables every alternate value on every
 * attribute simultaneously, with no click path out.
 */
export type ValueAvailability = AttributeOption & {
  available: boolean;
  reachable: boolean;
  inStock: boolean;
};

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

export function isSelectionComplete(
  variants: CompatibilityVariant[],
  selection: VariantSelection,
): boolean {
  const attrs = getVariantAttributes(variants);
  return attrs.length > 0 && attrs.every((g) => !!selection[g.attributeId]);
}

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
  clearedAttributeIds: string[];
};

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

/** Adapts this app's ProductVariantDTO shape (see lib/api/types.ts) to CompatibilityVariant. */
export function toCompatibilityVariant(v: {
  id: string;
  isActive: boolean;
  stockQty: number;
  values: {
    attributeValue: { id: string; value: string; attributeId: string; attribute: { name: string } };
  }[];
}): CompatibilityVariant {
  return {
    id: v.id,
    isActive: v.isActive,
    stockQty: v.stockQty,
    attributeValues: v.values.map((val) => ({
      attributeId: val.attributeValue.attributeId,
      attributeName: val.attributeValue.attribute.name,
      valueId: val.attributeValue.id,
      value: val.attributeValue.value,
    })),
  };
}

/**
 * Web's product-card-adapter.ts `resolveDefaultVariant`: the marked
 * default if it's active, else the first active variant, else the first
 * variant at all (undefined for a product with no variants). Used both by
 * the product detail screens (initial selection) and by ProductCard's
 * card-level Buy Now/Add to Cart, which never lets the shopper pick a
 * variant on the card itself.
 */
export function resolveDefaultVariant<
  T extends { id: string; isActive: boolean; isDefault?: boolean },
>(variants: T[]): T | undefined {
  return (
    variants.find((v) => v.isDefault && v.isActive) ??
    variants.find((v) => v.isActive) ??
    variants[0]
  );
}
