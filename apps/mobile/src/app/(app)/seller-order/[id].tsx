import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AppText, Badge, Button, ErrorState, Screen, SelectField } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getSellerOrder, getSellerPickupPoints, updateSellerOrderStatus } from "@/lib/api/seller";
import { ORDER_STATUS_LABEL, orderStatusTone } from "@/lib/order-status-labels";
import { Radius, Spacing } from "@/constants/theme";
import type { SellerOrderDTO } from "@/lib/api/types";

function formatRupees(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const NEXT_ACTION: Record<string, { action: string; label: string } | undefined> = {
  CONFIRMED: { action: "ACCEPT", label: "Accept order" },
  SELLER_ACCEPTED: { action: "PACK", label: "Mark packed" },
  PACKED: { action: "SCHEDULE_PICKUP", label: "Schedule pickup" },
  PICKUP_SCHEDULED: { action: "PICKED_UP", label: "Mark picked up" },
  PICKED_UP: { action: "IN_TRANSIT", label: "Mark in transit" },
  IN_TRANSIT: { action: "DELIVERED", label: "Mark delivered" },
};

export default function SellerOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [order, setOrder] = useState<SellerOrderDTO | null>(null);
  const [pickupPoints, setPickupPoints] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [orderResult, pointsResult] = await Promise.all([
      getSellerOrder(id),
      getSellerPickupPoints(),
    ]);
    if (!orderResult.ok) return setError(orderResult.error.message);
    setError(null);
    setOrder(orderResult.data.order);
    if (pointsResult.ok) {
      setPickupPoints(pointsResult.data.points);
      setPickupPointId(
        pointsResult.data.points.find((p) => p.isDefault)?.id ??
          pointsResult.data.points[0]?.id ??
          null,
      );
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!order) return null;

  const next = NEXT_ACTION[order.status];

  async function runAction(body: Parameters<typeof updateSellerOrderStatus>[1]) {
    setBusy(true);
    setActionError(null);
    const result = await updateSellerOrderStatus(id, body);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    load();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <AppText variant="title">#{order.orderNumber}</AppText>
          <Badge
            label={ORDER_STATUS_LABEL[order.status] ?? order.status}
            tone={orderStatusTone(order.status)}
          />
        </View>

        <View style={[styles.card, { borderColor: theme.border }]}>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <AppText variant="body" style={{ flex: 1 }}>
                {item.productName} × {item.quantity}
              </AppText>
              <AppText variant="bodyBold">{formatRupees(item.subtotal)}</AppText>
            </View>
          ))}
          <View style={styles.summaryRow}>
            <AppText variant="bodyBold">Total</AppText>
            <AppText variant="title">{formatRupees(order.totalAmount)}</AppText>
          </View>
        </View>

        {next?.action === "ACCEPT" && (
          <View style={styles.section}>
            <SelectField
              label="Pickup point"
              value={pickupPointId}
              onChange={setPickupPointId}
              options={pickupPoints.map((p) => ({ label: p.name, value: p.id }))}
            />
          </View>
        )}

        {actionError ? (
          <AppText variant="body" color="danger">
            {actionError}
          </AppText>
        ) : null}

        {next && (
          <Button
            label={next.label}
            loading={busy}
            disabled={next.action === "ACCEPT" && !pickupPointId}
            onPress={() =>
              runAction(
                next.action === "ACCEPT"
                  ? { action: "ACCEPT", pickupPointId: pickupPointId! }
                  : ({ action: next.action } as Parameters<typeof updateSellerOrderStatus>[1]),
              )
            }
            fullWidth
          />
        )}
        {order.status === "CONFIRMED" && (
          <Button
            label="Reject order"
            variant="danger"
            onPress={() => runAction({ action: "REJECT", reason: "Unable to fulfil" })}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  itemRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  section: { gap: Spacing.sm },
});
