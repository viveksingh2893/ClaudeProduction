import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";
import type { CategoryNode } from "@/lib/api/types";

/**
 * The storefront category ribbon (apps/web/src/components/category-nav.tsx)
 * — a scrollable row of tabs: a leading "Home" tab, then one per top-level
 * category (emoji in a rounded square, label with an active green
 * underline). Tapping a category opens /(app)/category/[slug].
 *
 * `activeSlug` marks the current category; on the Home screen none is
 * active so the Home tab lights up.
 */
export function CategoryRow({
  categories,
  activeSlug = null,
}: {
  categories: CategoryNode[];
  activeSlug?: string | null;
}) {
  if (categories.length === 0) return null;
  const homeActive = activeSlug === null;

  return (
    <FlatList
      horizontal
      data={categories}
      keyExtractor={(c) => c.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Tab
          label="Home"
          active={homeActive}
          onPress={() => router.push("/(app)/(tabs)")}
          icon={<HomeIcon active={homeActive} />}
        />
      }
      renderItem={({ item }) => {
        const active = item.slug === activeSlug;
        return (
          <Tab
            label={item.name}
            active={active}
            onPress={() =>
              router.push({ pathname: "/(app)/category/[slug]", params: { slug: item.slug } })
            }
            icon={<CategoryIcon category={item} active={active} />}
          />
        );
      }}
    />
  );
}

function Tab({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <View
        style={[
          styles.iconBadge,
          active
            ? { backgroundColor: theme.green100, borderColor: theme.green500 }
            : { backgroundColor: "rgba(255,255,255,0.55)", borderColor: theme.border },
        ]}
      >
        {icon}
      </View>
      <AppText
        numberOfLines={2}
        style={[
          styles.label,
          {
            color: active ? theme.ink : theme.textSecondary,
            fontWeight: active ? "700" : "400",
            borderBottomColor: active ? theme.green600 : "transparent",
          },
        ]}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  const theme = useTheme();
  return (
    <Ionicons name="home" size={22} color={active ? theme.green700 : theme.ink} />
  );
}

function CategoryIcon({ category, active }: { category: CategoryNode; active: boolean }) {
  const theme = useTheme();
  if (category.emoji) {
    return <AppText style={styles.emoji}>{category.emoji}</AppText>;
  }
  return (
    <AppText style={[styles.letter, { color: active ? theme.green700 : theme.green700 }]}>
      {category.name.charAt(0)}
    </AppText>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Spacing.sm, gap: 6, paddingVertical: Spacing.sm },
  tab: { width: 78, alignItems: "center", paddingHorizontal: 4, paddingTop: 8 },
  iconBadge: {
    width: 44,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 22, lineHeight: 26 },
  letter: { fontSize: 14, fontWeight: "800" },
  label: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 13,
    textAlign: "center",
    borderBottomWidth: 3,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
});
