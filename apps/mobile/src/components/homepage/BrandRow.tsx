import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, isUsableImageUrl, SafeImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import type { HomepageBrandDTO } from "@/lib/api/types";

const TILE_WIDTH = 160;
const TILE_HEIGHT = 104;

/**
 * "Shop by Brand" rail — approved, homepage-positioned brands
 * (Brand.imageUrl/Brand.homepagePosition, same source as the website's
 * ShopByBrand). Logos are contained (never cropped/stretched), matching
 * apps/web/src/components/homepage/shop-by-brand.tsx. Navigates by slug to
 * /(app)/brand/[slug], which filters getProducts/getDealerProducts by brand.
 */
export function BrandRow({ brands }: { brands: HomepageBrandDTO[] }) {
  if (brands.length === 0) return null;

  return (
    <View style={styles.section}>
      <AppText variant="subtitle" style={styles.title}>
        Shop by Brand
      </AppText>
      <FlatList
        horizontal
        data={brands}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <BrandTile brand={item} />}
      />
    </View>
  );
}

function BrandTile({ brand }: { brand: HomepageBrandDTO }) {
  const theme = useTheme();
  const showImage = isUsableImageUrl(brand.imageUrl);

  return (
    <Pressable
      style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={() => router.push({ pathname: "/(app)/brand/[slug]", params: { slug: brand.slug } })}
      accessibilityRole="button"
      accessibilityLabel={brand.name}
    >
      {showImage ? (
        <SafeImage
          uri={brand.imageUrl}
          style={styles.image}
          resizeMode="contain"
          accessibilityLabel={brand.name}
        />
      ) : (
        <AppText variant="caption" color="ink" numberOfLines={2} style={styles.placeholderText}>
          {brand.name}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm, paddingTop: Spacing.md },
  title: { paddingHorizontal: Spacing.lg },
  list: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xs,
  },
  image: { width: "100%", height: "100%" },
  placeholderText: { textAlign: "center" },
});
