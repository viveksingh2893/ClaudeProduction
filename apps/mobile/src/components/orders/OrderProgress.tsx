import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { Spacing } from "@/constants/theme";

/** The happy-path order journey, in order. The current status maps to the furthest step reached. */
const STEPS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "PLACED", label: "Placed", icon: "receipt-outline" },
  { key: "CONFIRMED", label: "Confirmed", icon: "checkmark-circle-outline" },
  { key: "PACKED", label: "Packed", icon: "cube-outline" },
  { key: "PICKED_UP", label: "Shipped", icon: "car-outline" },
  { key: "IN_TRANSIT", label: "In transit", icon: "navigate-outline" },
  { key: "DELIVERED", label: "Delivered", icon: "home-outline" },
];

const STEP_INDEX: Record<string, number> = {
  PENDING_PAYMENT: 0,
  PAYMENT_PARTIALLY_RECEIVED: 0,
  CONFIRMED: 1,
  SELLER_ACCEPTED: 1,
  PACKED: 2,
  PICKUP_SCHEDULED: 2,
  PICKED_UP: 3,
  IN_TRANSIT: 4,
  DELIVERED: 5,
  CLOSED: 5,
};

const OFF_HAPPY_PATH = new Set([
  "CANCELLED",
  "CANCELLATION_REQUESTED",
  "DELIVERY_FAILED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_REJECTED",
  "REPLACEMENT_APPROVED",
  "REPLACEMENT_DISPATCHED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "RTO_INITIATED",
  "RTO_DELIVERED_TO_SELLER",
]);

export function OrderProgressBar({ status }: { status: string }) {
  const theme = useTheme();
  if (OFF_HAPPY_PATH.has(status)) return null;
  const current = STEP_INDEX[status] ?? 0;

  return (
    <View style={styles.stepper}>
      {STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <View key={step.key} style={styles.stepCol}>
            <View style={styles.stepIconWrap}>
              {i > 0 ? (
                <View
                  style={[
                    styles.connector,
                    styles.connectorLeft,
                    { backgroundColor: i <= current ? theme.green600 : theme.border },
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? theme.green600 : theme.surface,
                    borderColor: done ? theme.green600 : theme.border,
                  },
                ]}
              >
                <Ionicons name={step.icon} size={13} color={done ? theme.onGreen : theme.textSecondary} />
              </View>
              {i < STEPS.length - 1 ? (
                <View
                  style={[
                    styles.connector,
                    styles.connectorRight,
                    { backgroundColor: i < current ? theme.green600 : theme.border },
                  ]}
                />
              ) : null}
            </View>
            <AppText
              variant="label"
              style={[styles.stepLabel, { color: done ? theme.green700 : theme.textSecondary }]}
              numberOfLines={1}
            >
              {step.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

export type TimelineEntry = { id: string; status: string; note: string | null; createdAt: string };

/** Full append-only status history as a vertical timeline (oldest first). */
export function OrderTimeline({ entries }: { entries: TimelineEntry[] }) {
  const theme = useTheme();
  return (
    <View style={styles.timeline}>
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        return (
          <View key={entry.id} style={styles.tRow}>
            <View style={styles.tRail}>
              <View
                style={[
                  styles.tDot,
                  { backgroundColor: last ? theme.green600 : theme.border },
                ]}
              />
              {!last ? <View style={[styles.tLine, { backgroundColor: theme.border }]} /> : null}
            </View>
            <View style={styles.tBody}>
              <AppText variant="body" style={{ fontWeight: last ? "700" : "500" }}>
                {ORDER_STATUS_LABEL[entry.status] ?? entry.status}
              </AppText>
              <AppText variant="caption" color="secondary">
                {new Date(entry.createdAt).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </AppText>
              {entry.note ? (
                <AppText variant="caption" color="secondary" style={styles.tNote}>
                  {entry.note}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "flex-start" },
  stepCol: { flex: 1, alignItems: "center" },
  stepIconWrap: {
    width: "100%",
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  connector: { position: "absolute", top: 12, height: 2 },
  connectorLeft: { left: 0, right: "50%" },
  connectorRight: { left: "50%", right: 0 },
  stepLabel: { marginTop: 4, fontSize: 10, textAlign: "center" },
  timeline: { gap: 0 },
  tRow: { flexDirection: "row", gap: Spacing.sm },
  tRail: { width: 12, alignItems: "center" },
  tDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  tLine: { width: 2, flex: 1, marginTop: 2 },
  tBody: { flex: 1, paddingBottom: Spacing.md },
  tNote: { marginTop: 2 },
});
