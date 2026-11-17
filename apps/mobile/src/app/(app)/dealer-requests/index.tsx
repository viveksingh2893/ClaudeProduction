import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { AppText, Badge, EmptyState, ErrorState, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getDealerRequests } from "@/lib/api/dealer";
import { Radius, Spacing } from "@/constants/theme";
import type { ProductRequestDTO } from "@/lib/api/types";

export default function DealerRequestsScreen() {
  const theme = useTheme();
  const [requests, setRequests] = useState<ProductRequestDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getDealerRequests();
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setRequests(result.data.requests);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (requests.length === 0) {
    return (
      <Screen>
        <EmptyState title="No requests yet" description="Request a product that isn't available in your state from any dealer product page." />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <View style={styles.row}>
              <AppText variant="bodyBold">Qty {item.quantity}</AppText>
              <Badge label={item.status} tone={item.status === "CLOSED" ? "success" : "info"} />
            </View>
            <AppText variant="caption" color="secondary">
              {item.deliveryAddress}
            </AppText>
            {item.note ? <AppText variant="caption">{item.note}</AppText> : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between" },
});
