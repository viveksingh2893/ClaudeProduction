import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from "react-native";
import { AppText } from "./AppText";
import { useTheme } from "@/hooks/use-theme";
import { actionFeedback, tapFeedback } from "@/lib/haptics";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";

/**
 * 1:1 with packages/ui/src/Button.tsx:
 *   primary   — bg-earth-600 / white text  (Buy Now, Place Order, Submit)
 *   secondary — transparent / green-700 text / 1.5px green-600 border  (Add to Cart)
 *   outline   — white / ink text / border  (filters, cancel)
 *   danger    — bg-danger / white text
 *   ghost     — transparent / green-700 text
 * radius rounded-md (8px); sm text-xs px-3 py-2, md text-sm px-5 py-3,
 * lg text-[15px] px-6 py-3.5.
 */

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
};

const SIZE_STYLE: Record<Size, { paddingHorizontal: number; paddingVertical: number; fontSize: number }> = {
  sm: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12 },
  md: { paddingHorizontal: 20, paddingVertical: 12, fontSize: 14 },
  lg: { paddingHorizontal: 24, paddingVertical: 14, fontSize: 15 },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  fullWidth,
  icon,
}: Props) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const bg: Record<Variant, string> = {
    primary: theme.earth600,
    secondary: "transparent",
    outline: theme.surface,
    danger: theme.danger,
    ghost: "transparent",
  };
  const border: Record<Variant, string | undefined> = {
    primary: undefined,
    secondary: theme.green600,
    outline: theme.border,
    danger: undefined,
    ghost: undefined,
  };
  const textColor: Record<Variant, "white" | "ink" | "green" | "danger"> = {
    primary: "white",
    secondary: "green",
    outline: "ink",
    danger: "white",
    ghost: "green",
  };

  const sz = SIZE_STYLE[size];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={
        isDisabled
          ? undefined
          : (e) => {
              if (variant === "primary" || variant === "danger") actionFeedback();
              else tapFeedback();
              onPress?.(e);
            }
      }
      style={({ pressed }) => [
        styles.base,
        {
          paddingHorizontal: sz.paddingHorizontal,
          paddingVertical: sz.paddingVertical,
          backgroundColor: bg[variant],
          borderColor: border[variant],
          borderWidth: border[variant] ? 1.5 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          borderRadius: Radius.md,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === "outline" || variant === "ghost" || variant === "secondary"
              ? theme.green700
              : "#FFFFFF"
          }
        />
      ) : (
        <View style={[styles.content, fullWidth && styles.fullWidthContent]}>
          {icon}
          <AppText
            variant="bodyBold"
            color={textColor[variant]}
            style={[styles.label, fullWidth && styles.fullWidthLabel, { fontSize: sz.fontSize }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            maxFontSizeMultiplier={1.2}
          >
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MinTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, flexShrink: 1 },
  fullWidthContent: { alignSelf: "stretch", justifyContent: "center", minWidth: 0 },
  label: { flexShrink: 1, minWidth: 0, textAlign: "center" },
  // Give Text a concrete width instead of its intrinsic label width. This
  // forces Android to recompute adjustsFontSizeToFit when a reused product
  // screen is opened again rather than clipping the final word.
  fullWidthLabel: { flex: 1 },
});
