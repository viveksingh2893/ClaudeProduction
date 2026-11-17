import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import {
  applySelection,
  getAvailableValuesForAttribute,
  getVariantAttributes,
  type CompatibilityVariant,
  type VariantSelection,
} from "@/lib/variant-compatibility";

type Props = {
  variants: CompatibilityVariant[];
  selection: VariantSelection;
  onChange: (result: { selection: VariantSelection; changeNote: string | null }) => void;
};

/**
 * Shared attribute-chip picker for both customer and dealer product
 * screens, backed by the same pure matching engine web uses
 * (lib/variant-compatibility.ts, mirroring packages/catalog). Distinguishes
 * "unavailable given the current selection" (dim/disabled) from
 * "available but out of stock" (struck through, still tappable) the way
 * web's VariantPicker does, and surfaces a change note when picking a
 * value clears an earlier, now-incompatible pick — mobile previously gave
 * no feedback at all when that happened.
 */
export function VariantAttributePicker({ variants, selection, onChange }: Props) {
  const theme = useTheme();
  const groups = getVariantAttributes(variants);

  function handlePick(attributeId: string, valueId: string) {
    const result = applySelection(variants, selection, attributeId, valueId);
    const changeNote =
      result.clearedAttributeIds.length > 0
        ? `${result.clearedAttributeIds
            .map((id) => groups.find((g) => g.attributeId === id)?.attributeName)
            .filter(Boolean)
            .join(", ")} reset because it's not available with this selection.`
        : null;
    onChange({ selection: result.selection, changeNote });
  }

  if (groups.length === 0) return null;

  return (
    <View style={{ gap: Spacing.md }}>
      {groups.map((group) => {
        const availability = getAvailableValuesForAttribute(variants, selection, group.attributeId);
        return (
          <View key={group.attributeId} style={styles.group}>
            <AppText variant="label" color="secondary">
              {group.attributeName.toUpperCase()}
            </AppText>
            <View style={styles.values}>
              {availability.map(({ valueId, value, available, reachable, inStock }) => {
                const selected = selection[group.attributeId] === valueId;
                // Gate on `reachable` (exists in SOME active variant at
                // all), not `available` (compatible with what's currently
                // selected elsewhere) — see reachable's doc comment in
                // lib/variant-compatibility.ts. Otherwise a sparse variant
                // matrix with no overlapping combinations disables every
                // alternate value simultaneously, with no way to tap out.
                const disabled = !reachable;
                return (
                  <Pressable
                    key={valueId}
                    disabled={disabled}
                    onPress={() => handlePick(group.attributeId, valueId)}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? theme.green700 : theme.border,
                        backgroundColor: selected ? theme.green50 : theme.surface,
                        opacity: disabled ? 0.35 : 1,
                      },
                    ]}
                  >
                    <AppText
                      variant="body"
                      color={selected ? "green" : "ink"}
                      style={available && !inStock ? styles.strike : undefined}
                    >
                      {value}
                    </AppText>
                    {available && !inStock ? (
                      <AppText variant="caption" color="secondary">
                        Out of stock
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.xs },
  values: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  strike: { textDecorationLine: "line-through" },
});
