import { useCallback, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText, EmptyState, ErrorState, Screen } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getBaReferees, type BaReferee } from "@/lib/api/ba";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
}

export default function BaRefereesScreen() {
  const theme = useTheme();
  const [rows, setRows] = useState<BaReferee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    const res = await getBaReferees();
    if (res.ok) {
      setRows(res.data.referees);
      setError(null);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshing={refreshing}
        onRefresh={() => void load(true)}
        ListHeaderComponent={
          <View style={styles.heading}>
            <AppText variant="title">Your referrals</AppText>
            <AppText color="secondary">Customers who joined using your referral code.</AppText>
          </View>
        }
        ListEmptyComponent={
          loading ? <AppText>Loading…</AppText> : error ? <ErrorState message={error} /> : <EmptyState title="No referrals yet" description="Share your referral link to invite customers." />
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <View style={styles.nameRow}>
              <View style={styles.grow}>
                <AppText variant="subtitle">{item.name}</AppText>
                <AppText color="secondary">Joined {new Date(item.joinedAt).toLocaleDateString("en-IN")}</AppText>
              </View>
              {item.phone ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${item.name}`}
                  onPress={() => Linking.openURL(`tel:${item.phone}`)}
                  style={[styles.call, { backgroundColor: theme.backgroundElement }]}
                >
                  <Ionicons name="call-outline" size={20} color={theme.tint} />
                </Pressable>
              ) : null}
            </View>
            {item.phone ? <AppText color="secondary">{item.phone}</AppText> : null}
            <View style={[styles.stats, { borderTopColor: theme.border }]}>
              <View><AppText variant="subtitle">{item.orderCount}</AppText><AppText color="secondary">Orders</AppText></View>
              <View style={styles.value}><AppText variant="subtitle">{money(item.orderValue)}</AppText><AppText color="secondary">Order value</AppText></View>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, flexGrow: 1 },
  heading: { gap: Spacing.xs, marginBottom: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  grow: { flex: 1 },
  call: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  stats: { borderTopWidth: 1, marginTop: Spacing.sm, paddingTop: Spacing.sm, flexDirection: "row" },
  value: { flex: 1, alignItems: "flex-end" },
});
