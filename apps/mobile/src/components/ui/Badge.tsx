import { StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral" | "earth";

export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  const theme = useTheme();
  const toneStyle: Record<BadgeTone, { bg: string; text: string }> = {
    success: { bg: theme.successBg, text: theme.success },
    warning: { bg: theme.warningBg, text: theme.warning },
    danger: { bg: theme.dangerBg, text: theme.danger },
    info: { bg: theme.infoBg, text: theme.info },
    neutral: { bg: theme.backgroundElement, text: theme.textSecondary },
    earth: { bg: theme.earth100, text: theme.earth700 },
  };
  const { bg, text } = toneStyle[tone];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <AppText variant="label" style={{ color: text }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
});
