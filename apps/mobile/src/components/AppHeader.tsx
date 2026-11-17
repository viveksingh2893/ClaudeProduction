import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText } from "@/components/ui";
import { NavMenu } from "@/components/NavMenu";
import { useT } from "@/context/language-context";
import { useTheme } from "@/hooks/use-theme";
import { tapFeedback } from "@/lib/haptics";
import { Radius, Spacing } from "@/constants/theme";

/**
 * The storefront's top header (katra4u-storefront-spec.md §1.2): logo
 * wordmark + a full-width search control + a menu button. Rendered inside
 * <AppChrome>'s frosted GlassSurface, so it has no surface fill or border
 * of its own — the search field and menu button are translucent "glass"
 * pills that sit on that pane. The search visual is a Pressable that opens
 * the dedicated search screen.
 */
export function AppHeader({
  showBack = false,
  hideSearch = false,
  onMenu,
}: {
  showBack?: boolean;
  /** Hide the tap-to-search pill (the search screen has its own real input). */
  hideSearch?: boolean;
  /** Optional override; defaults to opening the built-in <NavMenu> drawer. */
  onMenu?: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={styles.header}>
      {showBack ? (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/(tabs)"))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.ink} />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.replace("/(app)/(tabs)")}
          accessibilityRole="link"
          accessibilityLabel="Kisan4U home"
        >
          <Image
            source={require("@/assets/images/kisan4u-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </Pressable>
      )}

      {hideSearch ? (
        <View style={styles.searchSpacer} />
      ) : (
        <Pressable
          style={[styles.search, { borderColor: theme.border }]}
          onPress={() => {
            tapFeedback();
            router.push("/(app)/search");
          }}
          accessibilityRole="search"
          accessibilityLabel={t("nav.search")}
        >
          <Ionicons name="search" size={17} color={theme.green700} />
          <AppText
            variant="body"
            color="secondary"
            numberOfLines={1}
            style={styles.searchPlaceholder}
          >
            {t("nav.search")}
          </AppText>
        </Pressable>
      )}

      <Pressable
        style={[styles.menu, { borderColor: theme.border }]}
        onPress={() => {
          tapFeedback();
          if (onMenu) onMenu();
          else setMenuOpen(true);
        }}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="Open navigation menu"
      >
        <Ionicons name="menu" size={22} color={theme.ink} />
      </Pressable>

      <NavMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const GLASS_FILL = "rgba(255,255,255,0.55)";

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  logo: { width: 94, height: 26 },
  search: {
    flex: 1,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    backgroundColor: GLASS_FILL,
  },
  searchPlaceholder: { fontSize: 13, flex: 1 },
  searchSpacer: { flex: 1 },
  menu: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    backgroundColor: GLASS_FILL,
  },
});
