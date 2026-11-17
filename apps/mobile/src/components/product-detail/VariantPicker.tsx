import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { AppText } from "@/components/ui";
import { VariantAttributePicker } from "./VariantAttributePicker";
import { Spacing } from "@/constants/theme";
import {
  getInitialSelection,
  getVariantAttributes,
  isSelectionComplete,
  resolveVariant,
  toCompatibilityVariant,
  type VariantSelection,
} from "@/lib/variant-compatibility";
import type { ProductVariantDTO } from "@/lib/api/types";

/**
 * The one shared attribute-button variant selector — the mobile mirror of
 * @kisan4u/ui's <VariantPicker> (see packages/ui/src/VariantPicker.tsx).
 * Independent per-attribute chip rows resolve to one real variant/SKU;
 * `renderPurchaseArea` is handed the resolved variant so the customer PDP,
 * the dealer PDP and the "Select size" quick-add modal all share the exact
 * same selection UI instead of three drifting copies. Seeds from the
 * product's default variant on mount and reports it via `onResolvedChange`
 * so the gallery / sticky bar update on first paint, not only after a tap.
 */
export function VariantPicker({
  variants,
  defaultVariantId,
  onResolvedChange,
  renderPurchaseArea,
  incompleteHint,
}: {
  variants: ProductVariantDTO[];
  defaultVariantId?: string | null;
  onResolvedChange?: (variant: ProductVariantDTO | null) => void;
  renderPurchaseArea: (resolved: ProductVariantDTO) => ReactNode;
  incompleteHint?: string;
}) {
  const compat = useMemo(() => variants.map(toCompatibilityVariant), [variants]);
  const attributes = useMemo(() => getVariantAttributes(compat), [compat]);

  const [selection, setSelection] = useState<VariantSelection>(() =>
    getInitialSelection(compat, defaultVariantId),
  );
  const [changeNote, setChangeNote] = useState<string | null>(null);

  const resolvedCompat = resolveVariant(compat, selection);
  const resolved = resolvedCompat
    ? (variants.find((v) => v.id === resolvedCompat.id) ?? null)
    : null;
  const complete = isSelectionComplete(compat, selection);

  useEffect(() => {
    onResolvedChange?.(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the resolved variant's identity only
  }, [resolved?.id]);

  if (attributes.length === 0) return null;

  return (
    <View style={styles.root}>
      <VariantAttributePicker
        variants={compat}
        selection={selection}
        onChange={({ selection: next, changeNote: note }) => {
          setSelection(next);
          setChangeNote(note);
        }}
      />

      {changeNote ? (
        <AppText variant="caption" color="warning">
          {changeNote}
        </AppText>
      ) : null}

      {complete && resolved ? (
        renderPurchaseArea(resolved)
      ) : (
        <AppText variant="body" color="secondary">
          {incompleteHint ??
            `Select ${attributes.map((a) => a.attributeName).join(" and ")} to see price and availability.`}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.md },
});
