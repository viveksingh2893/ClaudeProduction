import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, EmptyState, ErrorState, SafeImage, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getCategories } from "@/lib/api/catalog";
import { useLanguage } from "@/context/language-context";
import { findCategoryById, resolveSelectedCategoryId } from "@/lib/category-shop";
import { Radius, Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import type { CategoryNode } from "@/lib/api/types";

const SCREEN_WIDTH = Dimensions.get("window").width;
const RAIL_WIDTH = Math.round(SCREEN_WIDTH * 0.26);
const CONTENT_WIDTH = SCREEN_WIDTH - RAIL_WIDTH;
const GRID_COLUMNS = 3;
const GRID_GAP = Spacing.sm;
const GRID_PADDING = Spacing.md;
const SUB_TILE_WIDTH = Math.floor(
  (CONTENT_WIDTH - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
);
const RAIL_IMAGE_SIZE = 44;
const SUB_IMAGE_SIZE = Math.min(SUB_TILE_WIDTH - Spacing.xs, 84);

/**
 * Two-pane category browser (layout/interaction adapted from a reference
 * screenshot — no branding, promotional-entry, or copy carried over from
 * it, only the rail+grid structure): a narrow left rail of top-level
 * categories, a right panel showing the selected category's active
 * subcategories in a 3-column grid. Categories/subcategories/images/order
 * all come from the existing category-tree endpoint
 * (getCategoryNavTree -> /api/mobile/v1/catalog/categories) — nothing
 * here is hard-coded, and the whole tree is fetched once so switching
 * between already-loaded top-level categories never re-fetches.
 */
export default function ShopScreen() {
  const theme = useTheme();
  const { dbLang } = useLanguage();
  const insets = useSafeAreaInsets();
  const scrollPad = { paddingBottom: insets.bottom + TAB_BAR_SCENE_INSET };
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const railRef = useRef<FlatList<CategoryNode>>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getCategories(dbLang);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setCategories(result.data.categories);
    setSelectedId((prev) => resolveSelectedCategoryId(result.data.categories, prev));
  }, [dbLang]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = findCategoryById(categories, selectedId);

  function selectCategory(index: number, category: CategoryNode) {
    setSelectedId(category.id);
    railRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }

  function openSubcategory(sub: { slug: string; name: string }) {
    if (!selected) return;
    router.push({
      pathname: "/(app)/category/[slug]",
      params: { slug: selected.slug, subCategory: sub.slug, title: sub.name },
    });
  }

  function viewAllInCategory() {
    if (!selected) return;
    router.push({
      pathname: "/(app)/category/[slug]",
      params: { slug: selected.slug, title: selected.name },
    });
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen edges={["top", "left", "right"]}>
      {loading ? (
        <View style={styles.loadingRow}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              style={[styles.railSkeletonItem, { backgroundColor: theme.backgroundElement }]}
            />
          ))}
        </View>
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories available"
          description="Check back soon — categories are managed by the Kisan4U team."
        />
      ) : (
        <View style={styles.body}>
          <FlatList
            ref={railRef}
            data={categories}
            keyExtractor={(c) => c.id}
            style={[styles.rail, { width: RAIL_WIDTH, borderRightColor: theme.border }]}
            contentContainerStyle={scrollPad}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => (
              <View style={[styles.railSeparator, { backgroundColor: theme.border }]} />
            )}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item, index }) => {
              const isSelected = item.id === selectedId;
              return (
                <Pressable
                  onPress={() => selectCategory(index, item)}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityState={{ selected: isSelected }}
                  style={[
                    styles.railTile,
                    {
                      backgroundColor: isSelected ? theme.green50 : "transparent",
                      borderLeftColor: isSelected ? theme.green700 : "transparent",
                    },
                  ]}
                >
                  <SafeImage
                    uri={item.imageUrl}
                    style={styles.railImage}
                    resizeMode="cover"
                    accessibilityLabel={item.name}
                    iconSize={20}
                  />
                  <AppText
                    variant={isSelected ? "bodyBold" : "caption"}
                    color={isSelected ? "green" : "ink"}
                    numberOfLines={3}
                    style={styles.railLabel}
                  >
                    {item.name}
                  </AppText>
                </Pressable>
              );
            }}
          />

          <ScrollView
            style={styles.content}
            contentContainerStyle={[styles.contentInner, scrollPad]}
            showsVerticalScrollIndicator={false}
          >
            {selected && (
              <>
                <View style={styles.headingRow}>
                  <AppText variant="subtitle" numberOfLines={1} style={styles.headingText}>
                    {selected.name}
                  </AppText>
                  <View style={[styles.headingDivider, { backgroundColor: theme.border }]} />
                </View>

                {selected.subCategories.length === 0 ? (
                  <EmptyState
                    title="No subcategories yet"
                    description={`Browse everything in ${selected.name} instead.`}
                    actionLabel={`View all ${selected.name}`}
                    onAction={viewAllInCategory}
                  />
                ) : (
                  <View style={styles.grid}>
                    {selected.subCategories.map((sub) => (
                      <Pressable
                        key={sub.id}
                        onPress={() => openSubcategory(sub)}
                        accessibilityRole="button"
                        accessibilityLabel={sub.name}
                        style={[styles.subTile, { width: SUB_TILE_WIDTH }]}
                      >
                        <SafeImage
                          uri={sub.imageUrl}
                          style={[
                            styles.subImage,
                            {
                              width: SUB_IMAGE_SIZE,
                              height: SUB_IMAGE_SIZE,
                              backgroundColor: theme.green50,
                            },
                          ]}
                          resizeMode="cover"
                          accessibilityLabel={sub.name}
                        />
                        <AppText
                          variant="caption"
                          color="ink"
                          numberOfLines={2}
                          style={styles.subLabel}
                        >
                          {sub.name}
                        </AppText>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: "row" },
  loadingRow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  railSkeletonItem: { width: "100%", height: 84, borderRadius: Radius.md },
  rail: { borderRightWidth: StyleSheet.hairlineWidth },
  railSeparator: { height: StyleSheet.hairlineWidth },
  railTile: {
    alignItems: "center",
    gap: Spacing.xxs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xxs,
    borderLeftWidth: 3,
    minHeight: 84,
    justifyContent: "center",
  },
  railImage: { width: RAIL_IMAGE_SIZE, height: RAIL_IMAGE_SIZE, borderRadius: Radius.md },
  railLabel: { textAlign: "center" },
  content: { flex: 1 },
  contentInner: { padding: GRID_PADDING, paddingBottom: Spacing.xxl },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  headingText: { flexShrink: 0 },
  headingDivider: { flex: 1, height: StyleSheet.hairlineWidth },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  subTile: { alignItems: "center", gap: Spacing.xxs, paddingVertical: Spacing.xs, minHeight: 48 },
  subImage: { borderRadius: Radius.md },
  subLabel: { textAlign: "center" },
});
