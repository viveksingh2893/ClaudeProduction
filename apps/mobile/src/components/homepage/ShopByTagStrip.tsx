import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, SafeImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import type { HomepageCropPestDTO } from "@/lib/api/types";

/**
 * "Shop by Crop" / "Shop by Pest & Disease" one-line strip — the mobile
 * mirror of apps/web/src/components/homepage/shop-by-tag-strip.tsx: a 17px
 * bold header then a horizontally-scrollable row of circular image tiles
 * with the name beneath. The image is a 1:1 background-removed PNG, so it's
 * contained inside the circle rather than cropped to fill it; the emoji is
 * only a placeholder until one is uploaded.
 *
 * Each chip navigates to /(app)/crop/[slug] or /(app)/pest-disease/[slug]
 * — the same audience-aware, tag-filtered product list the website's
 * /crops/<slug> and /pest-disease/<slug> (TagLandingPage) show, keyed by
 * `kind` rather than falling back to a generic name search.
 */
export function ShopByTagStrip({
  title,
  items,
  kind,
}: {
  title: string;
  items: HomepageCropPestDTO[];
  kind: "crop" | "pest";
}) {
  const theme = useTheme();
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <AppText variant="subtitle" style={styles.title}>
        {title}
      </AppText>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.tile}
            onPress={() =>
              router.push({
                pathname: kind === "crop" ? "/(app)/crop/[slug]" : "/(app)/pest-disease/[slug]",
                params: { slug: item.slug, name: item.name },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={item.name}
          >
            <View style={[styles.circle, { backgroundColor: theme.green50 }]}>
              {item.imageUrl ? (
                <SafeImage uri={item.imageUrl} style={styles.circleImg} resizeMode="contain" />
              ) : (
                <AppText style={styles.emoji}>
                  {item.emoji ?? item.name.slice(0, 2).toUpperCase()}
                </AppText>
              )}
            </View>
            <AppText variant="caption" numberOfLines={2} style={styles.label}>
              {item.name}
            </AppText>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm, paddingTop: Spacing.md },
  title: { paddingHorizontal: Spacing.lg },
  list: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  tile: { width: 72, alignItems: "center", gap: 6 },
  circle: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  circleImg: { width: "84%", height: "84%" },
  emoji: { fontSize: 26 },
  label: { textAlign: "center", lineHeight: 15 },
});
