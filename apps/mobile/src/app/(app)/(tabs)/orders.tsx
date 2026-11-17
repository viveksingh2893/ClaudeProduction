import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Badge, EmptyState, ErrorState, Screen, SafeImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/context/auth-context";
import { getOrderGroups } from "@/lib/api/orders";
import { getSellerOrders } from "@/lib/api/seller";
import { ORDER_STATUS_LABEL, orderStatusTone } from "@/lib/order-status-labels";
import { Radius, Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import type { CheckoutGroupDTO, SellerOrderDTO } from "@/lib/api/types";

const PAGE_SIZE = 10;

function formatRupees(value: number | string) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function OrdersScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const listPad = [styles.list, { paddingBottom: insets.bottom + TAB_BAR_SCENE_INSET }];
  const isSeller = user?.role === "SELLER";
  const [groups, setGroups] = useState<CheckoutGroupDTO[]>([]);
  const [sellerOrders, setSellerOrders] = useState<SellerOrderDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setVisibleCount(PAGE_SIZE);
    if (isSeller) {
      const result = await getSellerOrders();
      setLoading(false);
      if (!result.ok) return setError(result.error.message);
      setError(null);
      setSellerOrders(result.data.orders);
    } else {
      const result = await getOrderGroups();
      setLoading(false);
      if (!result.ok) return setError(result.error.message);
      setError(null);
      setGroups(result.data.groups);
    }
  }, [isSeller]);

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

  if (isSeller) {
    if (!loading && sellerOrders.length === 0) {
      return (
        <Screen edges={["top", "left", "right"]}>
          <EmptyState
            title="No orders yet"
            description="Orders placed for your products will show up here."
          />
        </Screen>
      );
    }
    return (
      <Screen edges={["top", "left", "right"]}>
        <FlatList
          data={sellerOrders.slice(0, visibleCount)}
          keyExtractor={(o) => o.id}
          contentContainerStyle={listPad}
          onEndReached={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, sellerOrders.length))}
          onEndReachedThreshold={0.5}
          initialNumToRender={PAGE_SIZE}
          windowSize={5}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
              onPress={() =>
                router.push({ pathname: "/(app)/seller-order/[id]", params: { id: item.id } })
              }
            >
              <View style={styles.cardHeader}>
                <AppText variant="bodyBold">#{item.orderNumber}</AppText>
                <Badge
                  label={ORDER_STATUS_LABEL[item.status] ?? item.status}
                  tone={orderStatusTone(item.status)}
                />
              </View>
              <AppText variant="body" color="secondary">
                {item.items.length} item{item.items.length === 1 ? "" : "s"} ·{" "}
                {formatRupees(item.totalAmount)}
              </AppText>
            </Pressable>
          )}
        />
      </Screen>
    );
  }

  if (!loading && groups.length === 0) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <EmptyState
          title="No orders yet"
          description="Your order history will show up here."
          actionLabel="Start shopping"
          onAction={() => router.push("/(app)/(tabs)/shop")}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <FlatList
        data={groups.slice(0, visibleCount)}
        keyExtractor={(g) => g.id}
        contentContainerStyle={listPad}
        onEndReached={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, groups.length))}
        onEndReachedThreshold={0.5}
        initialNumToRender={PAGE_SIZE}
        windowSize={5}
        renderItem={({ item: group }) => (
          <View style={styles.groupBlock}>
            <View style={styles.groupHeader}>
              <AppText variant="label" color="secondary">
                ORDER {group.groupNumber}
              </AppText>
              <AppText variant="caption" color="secondary">
                {formatDate(group.createdAt)}
              </AppText>
            </View>
            {group.sellerOrders.map((so) => {
              const thumbs = (so.items ?? []).slice(0, 4);
              const extra = (so.items ?? []).length - thumbs.length;
              const totalQty = (so.items ?? []).reduce((t, it) => t + it.quantity, 0);
              return (
                <Pressable
                  key={so.id}
                  style={[
                    styles.card,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/order/[groupId]/[sellerOrderId]",
                      params: { groupId: group.id, sellerOrderId: so.id },
                    })
                  }
                >
                  <View style={styles.cardHeader}>
                    <AppText variant="bodyBold" numberOfLines={1} style={{ flex: 1 }}>
                      {so.seller.shopName}
                    </AppText>
                    <Badge
                      label={ORDER_STATUS_LABEL[so.status] ?? so.status}
                      tone={orderStatusTone(so.status)}
                    />
                  </View>

                  <View style={styles.thumbRow}>
                    {thumbs.map((it) => (
                      <View
                        key={it.id}
                        style={[styles.thumb, { borderColor: theme.border, backgroundColor: theme.background }]}
                      >
                        <SafeImage uri={it.productImageUrl} style={styles.thumbImg} resizeMode="contain" />
                      </View>
                    ))}
                    {extra > 0 ? (
                      <View style={[styles.thumb, styles.thumbMore, { borderColor: theme.border, backgroundColor: theme.background }]}>
                        <AppText variant="caption" color="secondary">
                          +{extra}
                        </AppText>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.cardFooter}>
                    <AppText variant="caption" color="secondary">
                      #{so.orderNumber} · {totalQty} item{totalQty === 1 ? "" : "s"}
                    </AppText>
                    <AppText variant="bodyBold">{formatRupees(so.totalAmount)}</AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.lg },
  groupBlock: { gap: Spacing.xs },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.sm },
  thumbRow: { flexDirection: "row", gap: Spacing.xs },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbMore: { alignItems: "center", justifyContent: "center" },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Spacing.xs,
  },
});
