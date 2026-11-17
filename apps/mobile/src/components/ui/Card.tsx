import { StyleSheet, View, type ViewProps } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  // web packages/ui Card: rounded-xl border border-border bg-surface
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.md,
  },
});
