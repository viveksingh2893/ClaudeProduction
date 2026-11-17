import { useState, type ReactNode } from "react";
import { LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./AppText";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Item = { key: string; title: string; content: ReactNode };

/**
 * The storefront's "Product details" accordion card
 * (katra4u-storefront-spec.md §6.2-G): a `rounded-2xl` bordered surface
 * with hairline dividers; each row is an independent toggle (not
 * single-open), header 15px/700 ink with a rotating chevron, panel text
 * 14px/relaxed. `defaultOpenKeys` opens rows on mount (Description).
 */
export function Accordion({
  items,
  defaultOpenKeys = [],
}: {
  items: Item[];
  defaultOpenKeys?: string[];
}) {
  const theme = useTheme();
  const [open, setOpen] = useState<Set<string>>(new Set(defaultOpenKeys));

  function toggle(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (items.length === 0) return null;

  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      {items.map((item, i) => {
        const isOpen = open.has(item.key);
        return (
          <View
            key={item.key}
            style={i > 0 ? [styles.divider, { borderTopColor: theme.border }] : undefined}
          >
            <Pressable
              style={styles.header}
              onPress={() => toggle(item.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
            >
              <AppText variant="bodyBold" style={styles.headerText}>
                {item.title}
              </AppText>
              <Ionicons
                name={isOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={theme.textSecondary}
              />
            </Pressable>
            {isOpen ? <View style={styles.panel}>{item.content}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.xl, overflow: "hidden" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerText: { flex: 1, fontSize: 15 },
  panel: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, paddingTop: 0 },
});
