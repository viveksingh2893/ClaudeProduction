import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppText, Badge, EmptyState, ErrorState, SafeImage, Screen } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getBaRefereeOrders, type BaRefereeOrder } from "@/lib/api/ba";

const STATUS_TONE: Record<string, BadgeTone> = {
  DELIVERED: "success", CANCELLED: "danger", REFUNDED: "danger", RETURNED: "danger",
  PENDING: "warning", PROCESSING: "info", SHIPPED: "info", OUT_FOR_DELIVERY: "info",
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
}

function OrderCard({ order }: { order: BaRefereeOrder }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const customer = [order.refereeFirstName, order.refereeLastName].filter(Boolean).join(" ") || order.refereePhone || "Customer";
  return (
    <Pressable onPress={() => setExpanded((value) => !value)} style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <AppText variant="subtitle">{customer}</AppText>
          <AppText color="secondary">{order.orderNumber} · {new Date(order.createdAt).toLocaleDateString("en-IN")}</AppText>
        </View>
        <AppText variant="subtitle">{money(order.total)}</AppText>
      </View>
      <View style={styles.badges}>
        <Badge label={order.status.replace(/_/g, " ")} tone={STATUS_TONE[order.status] ?? "neutral"} />
        {order.placedByBa ? <Badge label="Placed by you" tone="earth" /> : null}
      </View>
      {expanded ? (
        <View style={[styles.items, { borderTopColor: theme.border }]}>
          {order.refereePhone ? <AppText color="secondary">Phone: {order.refereePhone}</AppText> : null}
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <SafeImage uri={item.imageUrl} style={styles.thumb} resizeMode="contain" accessibilityLabel={item.productName} />
              <View style={styles.grow}>
                <AppText>{item.productName}</AppText>
                <AppText color="secondary">{item.variantLabel ? `${item.variantLabel} · ` : ""}Qty {item.quantity}</AppText>
              </View>
            </View>
          ))}
        </View>
      ) : <AppText variant="label" color="secondary">Tap to view {order.items.length} item(s)</AppText>}
    </Pressable>
  );
}

export default function BaRefereeOrdersScreen() {
  const [orders, setOrders] = useState<BaRefereeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    const res = await getBaRefereeOrders();
    if (res.ok) { setOrders(res.data.orders); setError(null); } else setError(res.error.message);
    setLoading(false); setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshing={refreshing}
        onRefresh={() => void load(true)}
        ListHeaderComponent={<View style={styles.heading}><AppText variant="title">Referral orders</AppText><AppText color="secondary">Orders placed by your referred customers.</AppText></View>}
        ListEmptyComponent={loading ? <AppText>Loading…</AppText> : error ? <ErrorState message={error} /> : <EmptyState title="No referral orders" description="Orders from your referred customers will appear here." />}
        renderItem={({ item }) => <OrderCard order={item} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, flexGrow: 1 },
  heading: { gap: Spacing.xs, marginBottom: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  grow: { flex: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  items: { borderTopWidth: 1, paddingTop: Spacing.sm, gap: Spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  thumb: { width: 52, height: 52, borderRadius: Radius.sm },
});
