import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText, EmptyState, ErrorState, SafeImage, Screen, TextField } from "@/components/ui";
import { ProductCard } from "@/components/ProductCard";
import { getProducts } from "@/lib/api/catalog";
import { getDealerProducts } from "@/lib/api/dealer";
import { useAuth } from "@/context/auth-context";
import { useLanguage } from "@/context/language-context";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import type { DealerProductDTO, CustomerProductDTO } from "@/lib/api/types";

type AnyProduct = CustomerProductDTO | DealerProductDTO;

/** How many suggestion rows show before "See all results". */
const SUGGESTION_LIMIT = 5;
const MIN_QUERY = 2;

/**
 * Product search. The header search pill (AppHeader) is hidden on this
 * route, so this screen's own field is the ONLY input; the emoji category
 * ribbon is also suppressed here (NO_CATEGORY_RIBBON), so the field sits
 * directly under the top chrome with nothing pushing it down. As the user
 * types, the top matches show as a clean tap-through suggestion list;
 * "See all results" expands to the full 2-column grid.
 */
export default function SearchScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { dbLang } = useLanguage();
  const { category, q } = useLocalSearchParams<{ category?: string; q?: string }>();
  const isDealer = user?.role === "DEALER";

  const [query, setQuery] = useState(q ?? "");
  const [items, setItems] = useState<AnyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const trimmed = query.trim();
  const enoughToSearch = trimmed.length >= MIN_QUERY;

  const load = useCallback(async (nextPage = 1, append = false) => {
    if (!enoughToSearch) {
      setItems([]);
      setHasMore(false);
      setPage(1);
      setError(null);
      setLoading(false);
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    const result = isDealer
      ? await getDealerProducts({ category, q: trimmed, page: nextPage, pageSize: 20 })
      : await getProducts({ category, q: trimmed, lang: dbLang, page: nextPage, pageSize: 20 });
    setLoading(false);
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setItems((current) => append ? [...current, ...result.data.items.filter((item) => !current.some((old) => old.id === item.id))] : result.data.items);
    setPage(nextPage);
    setHasMore(result.data.hasMore);
  }, [isDealer, category, trimmed, dbLang, enoughToSearch]);

  useEffect(() => {
    setExpanded(false);
    const timeout = setTimeout(() => void load(1, false), 250);
    return () => clearTimeout(timeout);
  }, [load]);

  const suggestions = useMemo(() => items.slice(0, SUGGESTION_LIMIT), [items]);

  function openProduct(p: AnyProduct) {
    if (isDealer) router.push({ pathname: "/(app)/dealer-product/[id]", params: { id: p.id } });
    else router.push({ pathname: "/(app)/product/[slug]", params: { slug: p.slug } });
  }

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <View style={styles.searchWrap}>
        <TextField
          placeholder="Search products…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          autoFocus
        />
      </View>

      {!enoughToSearch ? (
        <EmptyState
          title="Search the catalogue"
          description="Type a product name, brand, or keyword to see suggestions."
        />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load(1, false)} />
      ) : loading ? (
        <View style={styles.skeletonWrap}>
          {Array.from({ length: SUGGESTION_LIMIT }).map((_, i) => (
            <View key={i} style={styles.skeletonRow} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <EmptyState title="No products found" description="Try a different search term." />
      ) : expanded ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => {
            if (hasMore && !loadingMore) void load(page + 1, true);
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.green700} /> : null}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              audience={isDealer ? "DEALER" : "CUSTOMER"}
              style={styles.cell}
            />
          )}
        />
      ) : (
        <View style={styles.suggestionCard}>
          {suggestions.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => openProduct(p)}
              android_ripple={{ color: theme.border }}
              style={[
                styles.suggestionRow,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
              ]}
              accessibilityRole="link"
              accessibilityLabel={p.name}
            >
              <SafeImage
                uri={p.primaryImageUrl}
                style={styles.thumb}
                resizeMode="cover"
                accessibilityLabel={p.name}
              />
              <View style={styles.suggestionText}>
                <AppText variant="body" numberOfLines={2} style={styles.suggestionName}>
                  {p.name}
                </AppText>
                {p.brand?.name ? (
                  <AppText variant="caption" color="secondary" numberOfLines={1}>
                    {p.brand.name}
                  </AppText>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </Pressable>
          ))}

          {items.length > SUGGESTION_LIMIT || hasMore ? (
            <Pressable
              onPress={() => setExpanded(true)}
              style={[
                styles.seeAll,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
              ]}
              accessibilityRole="button"
            >
              <AppText variant="label" color="green">
                See all results
              </AppText>
            </Pressable>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  skeletonWrap: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  skeletonRow: { height: 60, borderRadius: Radius.md, backgroundColor: "rgba(0,0,0,0.05)" },
  suggestionCard: {
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  thumb: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: "rgba(0,0,0,0.05)" },
  suggestionText: { flex: 1, gap: 2 },
  suggestionName: { fontSize: 13, fontWeight: "600" },
  seeAll: { paddingVertical: Spacing.sm, alignItems: "center" },
  grid: { padding: Spacing.lg, gap: Spacing.md },
  gridRow: { justifyContent: "space-between" },
  cell: { flex: 1, maxWidth: "48%", width: undefined },
});
