import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import {
  confirmAccountDeletion,
  getDeletionStatus,
  sendDeletionOtp,
  type DeletionStatus,
} from "@/lib/api/account-deletion";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export default function DeleteAccountScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { logout, refreshProfile } = useAuth();
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDeletionStatus().then((result) => {
      if (result.ok) setStatus(result.data);
      else toast.error(result.error.message);
    });
  }, [toast]);

  async function sendOtp() {
    setBusy(true);
    const result = await sendDeletionOtp();
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    setOtpSent(true);
    toast.success("OTP sent to your registered phone.");
  }

  async function confirm(immediate: boolean, forfeitWalletBalance = false) {
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6-digit OTP.");
    const walletBalance = status?.eligibility.walletBalance ?? 0;
    if (walletBalance > 0 && !forfeitWalletBalance) {
      Alert.alert(
        "Wallet balance will be forfeited immediately",
        `Your remaining wallet balance of ₹${walletBalance.toFixed(2)} will become zero as soon as this deletion request is submitted. It will not be returned if you restore the account. You can use it before requesting deletion instead.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Use balance", onPress: () => router.push("/(app)/(tabs)/shop") },
          {
            text: "Forfeit & continue",
            style: "destructive",
            onPress: () => void confirm(immediate, true),
          },
        ],
      );
      return;
    }
    setBusy(true);
    const result = await confirmAccountDeletion({ code, immediate, forfeitWalletBalance });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    if (immediate) {
      await logout();
      router.replace("/(auth)/welcome");
      return;
    }
    await refreshProfile();
    router.replace("/(app)/account-deletion-pending" as never);
  }

  const blockers = status?.eligibility.blockers ?? [];
  const eligible = status?.eligibility.eligible ?? false;
  const walletBalance = status?.eligibility.walletBalance ?? 0;

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="title" color="danger">
          Delete account
        </AppText>
        <AppText variant="body" color="secondary">
          Your account will be disabled immediately and permanently anonymized after a 14-day grace
          period. You can log in during that period to restore it.
        </AppText>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="bodyBold">Deleted permanently</AppText>
          <AppText variant="body" color="secondary">
            Phone, email, password, saved addresses, cart, wishlist, notifications and uploaded
            identity documents.
          </AppText>
        </View>

        {walletBalance > 0 ? (
          <View style={[styles.card, { borderColor: theme.warning }]}>
            <AppText variant="bodyBold">Wallet balance: ₹{walletBalance.toFixed(2)}</AppText>
            <AppText variant="body" color="secondary">
              Use this balance before deleting your account. If you continue with deletion, the
              remaining balance will be permanently forfeited immediately when the request is
              submitted and will not be returned if you restore the account.
            </AppText>
            <Button
              label="Shop and use wallet balance"
              variant="outline"
              onPress={() => router.push("/(app)/(tabs)/shop")}
              fullWidth
            />
          </View>
        ) : null}
        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="bodyBold">Retained for legal records</AppText>
          <AppText variant="body" color="secondary">
            Orders, payments, refunds, settlements and invoices remain, with your readable contact
            details removed.
          </AppText>
        </View>

        {blockers.length > 0 ? (
          <View style={[styles.card, { borderColor: theme.danger }]}>
            <AppText variant="bodyBold" color="danger">
              Deletion is currently blocked
            </AppText>
            {blockers.map((blocker) => (
              <AppText key={blocker.code} variant="body" color="secondary">
                • {blocker.message}
              </AppText>
            ))}
          </View>
        ) : null}

        {eligible && !otpSent ? (
          <Button
            label="Send confirmation OTP"
            variant="danger"
            onPress={sendOtp}
            loading={busy}
            fullWidth
          />
        ) : null}

        {eligible && otpSent ? (
          <View style={styles.confirm}>
            <TextField
              label="Confirmation OTP"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="6-digit OTP"
            />
            <Button
              label="Schedule deletion in 14 days"
              variant="danger"
              onPress={() => confirm(false)}
              loading={busy}
              fullWidth
            />
            <Button
              label="Delete now"
              variant="outline"
              onPress={() => confirm(true)}
              disabled={busy}
              fullWidth
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  confirm: { gap: Spacing.sm },
});
