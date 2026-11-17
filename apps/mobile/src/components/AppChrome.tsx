import { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UtilityRibbon } from "@/components/UtilityRibbon";
import { AppHeader } from "@/components/AppHeader";
import { CategoryRow } from "@/components/homepage/CategoryRow";
import { GlassSurface } from "@/components/ui";
import { useCategories } from "@/context/categories-context";
import { useTheme } from "@/hooks/use-theme";

/**
 * The storefront's shared top chrome (katra4u-storefront-spec.md §1):
 * green utility ribbon → then a single frosted "liquid glass" panel that
 * holds the search header and (on catalogue screens) the emoji category
 * ribbon, so header + ribbon read as one pane of glass with a bright
 * bottom edge. The PDP passes `showCategoryRibbon={false}` (§6.1).
 */
export function AppChrome({
  children,
  showBack = false,
  showCategoryRibbon = true,
  activeCategorySlug = null,
  hideHeaderSearch = false,
  onMenu,
}: {
  children: ReactNode;
  showBack?: boolean;
  showCategoryRibbon?: boolean;
  activeCategorySlug?: string | null;
  /** Hide the header's tap-to-search pill — used on the search screen itself, which has its own real input. */
  hideHeaderSearch?: boolean;
  onMenu?: () => void;
}) {
  const theme = useTheme();
  const categories = useCategories();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.green800 }}>
        <UtilityRibbon />
      </SafeAreaView>
      <GlassSurface
        edge="bottom"
        intensity={40}
        style={[styles.chrome, { shadowColor: theme.green900 }]}
      >
        <AppHeader showBack={showBack} onMenu={onMenu} hideSearch={hideHeaderSearch} />
        {showCategoryRibbon ? (
          <CategoryRow categories={categories} activeSlug={activeCategorySlug} />
        ) : null}
      </GlassSurface>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  chrome: {
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  content: { flex: 1 },
});
