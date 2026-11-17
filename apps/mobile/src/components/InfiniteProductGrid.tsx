import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { EmptyState, ProductCardSkeleton } from "@/components/ui";
import { ProductCard } from "@/components/ProductCard";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";
import type { CustomerProductDTO, DealerProductDTO } from "@/lib/api/types";

type Product = CustomerProductDTO | DealerProductDTO;

export type ProductPage = { items: Product[]; hasMore: boolean };

/**
 * The "All products" / "More products" 2-column feed with cursor-style
 * pagination — the mobile mirror of
 * apps/web/src/components/homepage/infinite-product-grid.tsx. The caller
 * supplies `fetchPage(page)` (customer vs dealer catalogue lives in the
 * caller, not here); this fetches page 1 on mount and the next page as the
 * list nears its end. `ListHeaderComponent` lets a screen (the PDP, a
 * category page) put all its other content above the feed while keeping ONE
 * scroll container — never a VirtualizedList nested in a ScrollView.
 * `excludeIds` drops products already shown elsewhere on the screen.
 */
export function InfiniteProductGrid({
  fetchPage,
  audience,
  excludeIds = [],
  ListHeaderComponent,
  emptyTitle = "No products here yet",
  contentBottomInset = 0,
}: {
  fetchPage: (page: number) => Promise<ProductPage | null>;
  audience: "CUSTOMER" | "DEALER";
  excludeIds?: string[];
  ListHeaderComponent?: ReactElement | null;
  emptyTitle?: string;
  /** Extra bottom padding on the scroll content — e.g. to clear a floating bottom bar on screens outside the (tabs) navigator. */
  contentBottomInset?: number;
}) {
  const theme = useTheme();
  const excluded = useRef(new Set(excludeIds));
  const [items, setItems] = useState<Product[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const loadingRef = useRef(false);

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    const next = page + 1;
    const res = await fetchPage(next);
    if (res) {
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const fresh = res.items.filter((p) => !seen.has(p.id) && !excluded.current.has(p.id));
        return [...prev, ...fresh];
      });
      setPage(next);
      setHasMore(res.hasMore);
    } else {
      setHasMore(false);
    }
    setLoading(false);
    setInitialLoad(false);
    loadingRef.current = false;
  }, [fetchPage, hasMore, page]);

  useEffect(() => {
    // Reset + reload when the fetcher identity changes (new category/filter).
    excluded.current = new Set(excludeIds);
    setItems([]);
    setPage(0);
    setHasMore(true);
    setInitialLoad(true);
    loadingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the fetcher only
  }, [fetchPage]);

  useEffect(() => {
    if (page === 0 && hasMore && !loadingRef.current) void loadNext();
  }, [page, hasMore, loadNext]);

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={[
        styles.list,
        contentBottomInset ? { paddingBottom: Spacing.lg + contentBottomInset } : null,
      ]}
      ListHeaderComponent={ListHeaderComponent}
      onEndReached={() => void loadNext()}
      onEndReachedThreshold={0.6}
      renderItem={({ item }) => (
        <ProductCard product={item} audience={audience} style={styles.cell} />
      )}
      ListEmptyComponent={
        initialLoad ? (
          <View style={styles.skeletonGrid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </View>
        ) : (
          <EmptyState title={emptyTitle} />
        )
      }
      ListFooterComponent={
        loading && !initialLoad ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.green700} />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.md },
  row: { justifyContent: "space-between" },
  cell: { flex: 1, maxWidth: "48%" },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  footer: { paddingVertical: Spacing.lg },
});
