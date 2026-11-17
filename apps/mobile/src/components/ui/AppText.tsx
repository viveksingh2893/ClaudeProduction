import { Text, type TextProps } from "react-native";
import { useTheme } from "@/hooks/use-theme";

export type AppTextVariant = "display" | "title" | "subtitle" | "body" | "bodyBold" | "caption" | "label";

const VARIANT_STYLE: Record<AppTextVariant, { fontSize: number; fontWeight: "400" | "500" | "600" | "700" | "800"; lineHeight: number }> = {
  display: { fontSize: 26, fontWeight: "800", lineHeight: 32 },
  title: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  subtitle: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  body: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  bodyBold: { fontSize: 14, fontWeight: "700", lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: "400", lineHeight: 16 },
  label: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
};

type Props = TextProps & {
  variant?: AppTextVariant;
  color?: "ink" | "secondary" | "green" | "earth" | "success" | "warning" | "danger" | "white";
};

export function AppText({ variant = "body", color = "ink", style, ...rest }: Props) {
  const theme = useTheme();
  const colorMap: Record<NonNullable<Props["color"]>, string> = {
    ink: theme.ink,
    secondary: theme.textSecondary,
    green: theme.green700,
    earth: theme.earth700,
    success: theme.success,
    warning: theme.warning,
    danger: theme.danger,
    white: "#FFFFFF",
  };

  return <Text style={[VARIANT_STYLE[variant], { color: colorMap[color] }, style]} {...rest} />;
}
