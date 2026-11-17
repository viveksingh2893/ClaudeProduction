import { StyleSheet, View } from "react-native";
import { AppText } from "@/components/ui";
import { BannerCarousel } from "./BannerCarousel";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import type { HeroBannerDTO } from "@/lib/api/types";

/**
 * The first thing on a category page — the mobile mirror of
 * apps/web/src/components/homepage/category-hero.tsx: that category's own
 * banner carousel (through the SAME <BannerCarousel> the home hero uses)
 * when the admin has assigned banners to it, otherwise a category-branded
 * placeholder so the page still opens on a banner-shaped block, not a bare
 * heading.
 */
export function CategoryHero({
  banners,
  categoryName,
  emoji,
}: {
  banners: HeroBannerDTO[];
  categoryName: string;
  emoji: string | null;
}) {
  const theme = useTheme();

  if (banners.length > 0) {
    return (
      <View style={styles.wrap}>
        <BannerCarousel banners={banners} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.placeholder, { backgroundColor: theme.green700 }]}>
        {emoji ? <AppText style={styles.emoji}>{emoji}</AppText> : null}
        <AppText color="white" variant="title" style={styles.name}>
          {categoryName}
        </AppText>
        <AppText color="white" variant="caption" style={styles.sub}>
          Explore everything in {categoryName}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: Spacing.md },
  placeholder: {
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.xl,
    aspectRatio: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: Spacing.lg,
  },
  emoji: { fontSize: 44 },
  name: { textAlign: "center" },
  sub: { textAlign: "center", opacity: 0.85 },
});
