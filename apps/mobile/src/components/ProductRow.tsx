import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { AppText } from "@/components/ui";
import { ProductCard } from "./ProductCard";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";
import type { DealerProductDTO, CustomerProductDTO } from "@/lib/api/types";

type Product = CustomerProductDTO | DealerProductDTO;

/**
 * A homepage / category product section — the mobile mirror of
 * apps/web/src/components/homepage/product-row.tsx. `layout="scroll"`
 * (default) is a single horizontally-scrolling rail of compact cards;
 * `layout="grid"` wraps them into a 2-column grid (used for Best Sellers,
 * Trending and the per-category rows). A 17px bold header with an optional
 * "View all ›". Renders nothing when empty.
 */
export function ProductRow({
  title,
  products,
  audience,
  layout = "scroll",
  viewMoreHref,
}: {
  title: string;
  products: Product[];
  audience: "CUSTOMER" | "DEALER";
  layout?: "scroll" | "grid";
  viewMoreHref?: Href;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  if (products.length === 0) return null;

  const railItemWidth = Math.min(150, Math.round(width * 0.38));
  const gridItemWidth = (width - Spacing.lg * 2 - Spacing.md) / 2;

  const header = (
    <View style={styles.headerRow}>
      <AppText variant="subtitle" style={styles.title}>
        {title}
      </AppText>
      {viewMoreHref ? (
        <Pressable
          style={styles.viewAll}
          onPress={() => router.push(viewMoreHref)}
          accessibilityRole="button"
          accessibilityLabel={`View all ${title}`}
        >
          <AppText variant="label" color="green">
            View all
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={theme.green700} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.section}>
      {header}
      {layout === "grid" ? (
        <View style={styles.grid}>
          {products.slice(0, 8).map((item) => (
            <ProductCard
              key={item.id}
              product={item}
              audience={audience}
              style={{ width: gridItemWidth }}
            />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={products}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={3}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ProductCard product={item} audience={audience} style={{ width: railItemWidth }} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm, paddingTop: Spacing.md },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
  },
  title: { flexShrink: 1 },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 2 },
  list: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
});
