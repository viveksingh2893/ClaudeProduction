import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet } from "react-native";
import { router } from "expo-router";
import { EmptyState, ErrorState, Screen } from "@/components/ui";
import { ProductCard } from "@/components/ProductCard";
import { getWishlist } from "@/lib/api/wishlist";
import { useAuth } from "@/context/auth-context";
import { Spacing } from "@/constants/theme";
import type { DealerProductDTO, CustomerProductDTO } from "@/lib/api/types";

export default function WishlistScreen() {
  const { user } = useAuth();
  const isDealer = user?.role === "DEALER";
  const [products, setProducts] = useState<(CustomerProductDTO | DealerProductDTO)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getWishlist();
    setLoading(false);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setProducts(result.data.products);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!loading && products.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="Your wishlist is empty"
          description="Tap the heart on any product to save it here."
          actionLabel="Browse products"
          onAction={() => router.push("/(app)/(tabs)/shop")}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            audience={isDealer ? "DEALER" : "CUSTOMER"}
            style={styles.cell}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.md },
  row: { justifyContent: "space-between" },
  cell: { flex: 1, maxWidth: "48%", width: undefined },
});
