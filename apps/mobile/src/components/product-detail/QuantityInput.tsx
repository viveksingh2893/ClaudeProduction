import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { clampQuantity } from "@/lib/quantity";

export { clampQuantity } from "@/lib/quantity";

type Props = {
  quantity: number;
  minQuantity: number;
  maxQuantity?: number;
  step?: number;
  onChange: (quantity: number) => void;
  showLabel?: boolean;
  disabled?: boolean;
  compact?: boolean;
};

/** Quantity editor with a temporary text draft so users can replace the whole value naturally. */
export function QuantityInput({
  quantity,
  minQuantity,
  maxQuantity,
  step = 1,
  onChange,
  showLabel = true,
  disabled,
  compact = false,
}: Props) {
  const theme = useTheme();
  const focused = useRef(false);
  const [draft, setDraft] = useState(String(quantity));
  const min = Math.max(1, minQuantity);
  const max = maxQuantity == null ? undefined : Math.max(min, maxQuantity);

  useEffect(() => {
    if (!focused.current) setDraft(String(quantity));
  }, [quantity]);

  function commit(raw = draft) {
    const next = clampQuantity(Number(raw || min), min, max);
    setDraft(String(next));
    if (next !== quantity) onChange(next);
  }

  function nudge(delta: number) {
    const next = clampQuantity(quantity + delta, min, max);
    setDraft(String(next));
    if (next !== quantity) onChange(next);
  }

  return (
    <View style={[styles.row, compact && styles.compactRow]}>
      {showLabel ? <AppText variant="bodyBold">Quantity</AppText> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        style={[
          styles.button,
          compact && styles.compactButton,
          { borderColor: theme.border, opacity: disabled || quantity <= min ? 0.4 : 1 },
        ]}
        onPress={() => nudge(-step)}
        disabled={disabled || quantity <= min}
        hitSlop={compact ? 6 : undefined}
      >
        <Ionicons name="remove" size={17} color={theme.ink} />
      </Pressable>
      <TextInput
        accessibilityLabel="Quantity"
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onSubmitEditing={() => commit()}
        onChangeText={(value) => setDraft(value.replace(/\D/g, "").slice(0, 5))}
        selectTextOnFocus
        keyboardType="number-pad"
        maxLength={5}
        editable={!disabled}
        style={[
          styles.input,
          compact && styles.compactInput,
          { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        style={[
          styles.button,
          compact && styles.compactButton,
          { borderColor: theme.border, opacity: disabled || (max != null && quantity >= max) ? 0.4 : 1 },
        ]}
        onPress={() => nudge(step)}
        disabled={disabled || (max != null && quantity >= max)}
        hitSlop={compact ? 6 : undefined}
      >
        <Ionicons name="add" size={17} color={theme.ink} />
      </Pressable>
      {showLabel && min > 1 ? (
        <AppText variant="caption" color="secondary">
          Min. {min}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  button: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    width: 58,
    height: MinTouchTarget,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xs,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
  },
  compactRow: { gap: 2 },
  compactButton: { width: 32, height: 40 },
  compactInput: { width: 38, height: 40, minHeight: 40, paddingHorizontal: 2, fontSize: 14 },
});
