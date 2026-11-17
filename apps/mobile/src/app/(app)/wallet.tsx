import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText, Button, EmptyState, ErrorState, Screen, TextField } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { createWalletTopupOrder, getWallet, verifyWalletTopup } from "@/lib/api/wallet";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { Radius, Spacing } from "@/constants/theme";
import type { WalletSummary } from "@/lib/api/wallet";

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

function formatRupees(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const TRANSACTION_LABEL: Record<string, string> = {
  ORDER_PAYMENT: "Applied to an order",
  REFUND_CREDIT: "Refunded from a cancelled order",
  WALLET_TOPUP: "Added to wallet",
  ORDER_COMMISSION: "Order commission",
  ORDER_EARNING: "Order earning",
  DELIVERY_CHARGE: "Delivery charge",
  COD_COLLECTION: "COD collection",
  REFUND_DEBIT: "Refund debit",
  WITHDRAWAL: "Withdrawal",
  LOYALTY_BONUS: "Loyalty bonus",
  REFERRAL_COMMISSION: "Referral commission",
};

export default function WalletScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getWallet();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setWallet(result.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleTopUp() {
    const amount = Math.round(Number(topUpAmount));
    if (!(amount > 0)) {
      setMessage("Enter an amount greater than zero.");
      return;
    }
    setToppingUp(true);
    setMessage(null);

    const created = await createWalletTopupOrder(amount);
    if (!created.ok) {
      setToppingUp(false);
      setMessage(created.error.message);
      return;
    }

    const pay = await openRazorpayCheckout({
      keyId: created.data.keyId,
      orderId: created.data.razorpayOrderId,
      amountPaise: created.data.amountPaise,
      name: "Kisan4U Wallet",
      description: `Add ${formatRupees(amount)} to wallet`,
      prefillContact: undefined,
      prefillName:
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
      themeColor: theme.green700,
    });

    if (!pay.ok) {
      setToppingUp(false);
      setMessage(
        pay.cancelled
          ? "Top-up cancelled — nothing was charged."
          : `Payment failed: ${pay.message}`,
      );
      return;
    }

    const verified = await verifyWalletTopup({
      topupId: created.data.topupId,
      razorpayOrderId: pay.data.razorpay_order_id,
      razorpayPaymentId: pay.data.razorpay_payment_id,
      razorpaySignature: pay.data.razorpay_signature,
    });
    setToppingUp(false);
    if (!verified.ok) {
      setMessage(
        "Payment received — it may take a moment to reflect in your balance.",
      );
      load();
      return;
    }
    setTopUpAmount("");
    setMessage(`₹${amount} added to your wallet.`);
    load();
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!wallet) return null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View
          style={[
            styles.balanceCard,
            { backgroundColor: theme.green50, borderColor: theme.border },
          ]}
        >
          <AppText variant="caption" color="secondary">
            Available balance
          </AppText>
          <AppText variant="display" color="green">
            {formatRupees(wallet.balance)}
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">Add money</AppText>
          <View style={styles.chipRow}>
            {QUICK_AMOUNTS.map((amt) => {
              const active = Number(topUpAmount) === amt;
              return (
                <Pressable
                  key={amt}
                  onPress={() => setTopUpAmount(String(amt))}
                  style={[
                    styles.chip,
                    { borderColor: active ? theme.green700 : theme.border },
                    active && { backgroundColor: theme.green50 },
                  ]}
                >
                  <AppText variant="label" color={active ? "green" : "secondary"}>
                    ₹{amt.toLocaleString("en-IN")}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <TextField
            placeholder="Enter amount"
            value={topUpAmount}
            onChangeText={setTopUpAmount}
            keyboardType="numeric"
          />
          <Button
            label={topUpAmount ? `Pay ₹${Math.round(Number(topUpAmount)) || 0}` : "Top up"}
            onPress={handleTopUp}
            loading={toppingUp}
            disabled={!topUpAmount}
          />
          <AppText variant="caption" color="secondary">
            Paid securely via Razorpay (UPI, cards, netbanking).
          </AppText>
          {message ? (
            <AppText
              variant="caption"
              color={/added|received/i.test(message) ? "success" : "danger"}
            >
              {message}
            </AppText>
          ) : null}
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">Recent activity</AppText>
          {wallet.recent.length === 0 ? (
            <EmptyState title="No wallet activity yet" />
          ) : (
            wallet.recent.map((t) => (
              <View key={t.id} style={[styles.txnRow, { borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <AppText variant="body">{TRANSACTION_LABEL[t.reason] ?? t.reason}</AppText>
                  <AppText variant="caption" color="secondary">
                    {new Date(t.createdAt).toLocaleString()}
                  </AppText>
                </View>
                <AppText variant="bodyBold" color={t.type === "CREDIT" ? "success" : "danger"}>
                  {t.type === "CREDIT" ? "+" : "−"} {formatRupees(t.amount)}
                </AppText>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  balanceCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, gap: 4 },
  section: { gap: Spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    borderWidth: 1.5,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
