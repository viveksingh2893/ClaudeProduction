import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Button, ErrorState, SafeImage, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import { getProposedOrder, decideProposedOrder, type ProposedOrderDetail } from "@/lib/api/ba";

export default function BaOrderApprovalScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [po, setPo] = useState<ProposedOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await getProposedOrder(id);
    if (!res.ok) setError(res.error.message);
    else setPo(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(decision: "APPROVE" | "REJECT" | "CUSTOMIZE") {
    if (!id) return;
    setBusy(true);
    const res = await decideProposedOrder(id, decision);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    if (decision === "CUSTOMIZE") router.replace("/(app)/(tabs)/cart");
    else if (decision === "APPROVE") router.replace("/(app)/(tabs)/orders");
    else router.back();
  }

  if (error) return <Screen><ErrorState message={error} /></Screen>;
  if (!po) return <Screen><View style={styles.pad}><AppText>Loading…</AppText></View></Screen>;

  const addr = po.addressSnapshot;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.pad}>
        <AppText variant="title">Order prepared for you</AppText>
        <AppText color="secondary">
          {po.baName} prepared this COD order for {po.refereeName}. Review and choose what to do.
        </AppText>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="subtitle">Items</AppText>
          {po.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <SafeImage uri={it.imageUrl} style={styles.thumb} resizeMode="contain" accessibilityLabel={it.productName} />
              <AppText style={styles.grow}>
                {it.productName}{it.variantLabel ? ` — ${it.variantLabel}` : ""} × {it.quantity}
              </AppText>
              <AppText>₹{it.lineTotal.toFixed(2)}</AppText>
            </View>
          ))}
          <View style={styles.row}>
            <AppText variant="subtitle">Total (COD)</AppText>
            <AppText variant="subtitle">₹{po.grandTotal.toFixed(2)}</AppText>
          </View>
        </View>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="subtitle">Delivery address</AppText>
          <AppText color="secondary">
            {addr.fullName}, {addr.mobile}
            {"\n"}
            {addr.line1}
            {addr.line2 ? `, ${addr.line2}` : ""}
            {"\n"}
            {addr.cityTown}, {addr.state} {addr.pincode}
          </AppText>
        </View>

        {po.isReferee && po.status === "AWAITING_REFEREE" ? (
          <View style={{ gap: Spacing.sm }}>
            <Button label="Approve & place (COD)" onPress={() => decide("APPROVE")} loading={busy} fullWidth />
            <Button label="Customize in cart" variant="outline" onPress={() => decide("CUSTOMIZE")} disabled={busy} fullWidth />
            <Button label="Decline" variant="ghost" onPress={() => decide("REJECT")} disabled={busy} fullWidth />
          </View>
        ) : (
          <AppText color="secondary">This order is {po.status.replace(/_/g, " ").toLowerCase()}.</AppText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.lg, gap: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  grow: { flex: 1 },
  thumb: { width: 52, height: 52, borderRadius: Radius.sm },
});
