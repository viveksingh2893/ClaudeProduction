import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { AppText, SafeImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

type Tile = { id: string; name: string; slug: string; imageUrl: string | null };

/**
 * The single-row square-tile scroller on a category page — the mobile
 * mirror of apps/web/src/components/homepage/subcategory-scroller.tsx: a
 * freely horizontally-scrolling strip of tiles in one line (never wraps
 * to a second row), each a rounded-square image (first letter until a
 * real image is uploaded) with a short label. `onOpen` gets the tapped
 * tile.
 */
export function SubcategoryScroller({
  items,
  onOpen,
}: {
  items: Tile[];
  onOpen: (tile: Tile) => void;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;

  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(tile) => tile.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item: tile }) => (
        <Pressable
          style={styles.tile}
          onPress={() => onOpen(tile)}
          accessibilityRole="button"
          accessibilityLabel={tile.name}
        >
          <View style={[styles.square, { backgroundColor: theme.green50 }]}>
            {tile.imageUrl ? (
              <SafeImage uri={tile.imageUrl} style={styles.squareImg} resizeMode="cover" />
            ) : (
              <AppText style={styles.letter} color="green">
                {tile.name.charAt(0)}
              </AppText>
            )}
          </View>
          <AppText variant="caption" numberOfLines={2} style={styles.label}>
            {tile.name}
          </AppText>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md },
  tile: { width: 76, alignItems: "center", gap: 6 },
  square: {
    width: 68,
    height: 68,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  squareImg: { width: "100%", height: "100%" },
  letter: { fontSize: 22, fontWeight: "800" },
  label: { textAlign: "center", lineHeight: 15 },
});
