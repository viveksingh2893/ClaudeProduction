import { useCallback, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppText, Badge, EmptyState, ErrorState, SafeImage, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getSellerProducts } from "@/lib/api/seller";
import { Radius, Spacing } from "@/constants/theme";

type SellerProductRow = {
  id: string;
  name: string;
  sku: string;
  primaryImageUrl: string;
  lifecycleStatus: string;
  customerConfig?: { currentStock: number } | null;
  dealerConfig?: { currentStock: number } | null;
};

export default function SellerProductsScreen() {
  const theme = useTheme();
  const [products, setProducts] = useState<SellerProductRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getSellerProducts();
    setLoading(false);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setProducts(result.data.products as SellerProductRow[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (error) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }

  if (!loading && products.length === 0) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <EmptyState
          title="No products yet"
          description="Add products from the seller web panel — product management is coming to mobile soon."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const stock = item.customerConfig?.currentStock ?? item.dealerConfig?.currentStock ?? null;
          return (
            <View
              style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
            >
              <SafeImage
                uri={item.primaryImageUrl}
                style={styles.thumb}
                accessibilityLabel={item.name}
              />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyBold" numberOfLines={2}>
                  {item.name}
                </AppText>
                <AppText variant="caption" color="secondary">
                  SKU {item.sku} {stock != null ? `· Stock ${stock}` : ""}
                </AppText>
              </View>
              <Badge
                label={item.lifecycleStatus}
                tone={item.lifecycleStatus === "APPROVED" ? "success" : "warning"}
              />
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.sm },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
  },
  thumb: { width: 48, height: 48, borderRadius: Radius.md },
});
