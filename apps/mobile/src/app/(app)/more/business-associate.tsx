import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { AppText, Button, ErrorState, Screen } from "@/components/ui";
import { BankDetailsForm } from "@/components/ba/BankDetailsForm";
import { BasicDetailsForm } from "@/components/ba/BasicDetailsForm";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import { getBaDashboard, type BaDashboard } from "@/lib/api/ba";
import { SITE_ORIGIN } from "@/lib/site-origin";

function referralUrl(code: string): string {
  return `${SITE_ORIGIN.replace(/\/$/, "")}/r/${code}`;
}

async function shareReferral(code: string) {
  const url = referralUrl(code);
  try {
    await Share.share({
      message: `Join Kisan4U with my referral code ${code} and shop seeds, fertilizers & equipment. Sign up here: ${url}`,
      url,
      title: "Kisan4U referral",
    });
  } catch {
    /* user dismissed the share sheet */
  }
}

const STATUS_LABEL: Record<string, string> = {
  NOT_REGISTERED: "Not registered as BA",
  PENDING: "Pending for approval",
  APPROVED_NO_BANK: "Approved BA — bank details pending",
  APPROVED: "Approved BA",
  REJECTED: "Application rejected",
  SUSPENDED: "Suspended",
};

export default function BusinessAssociateScreen() {
  const theme = useTheme();
  const [data, setData] = useState<BaDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await getBaDashboard();
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setData(res.data);
  }, []);

  // Refetch every time this screen gains focus (not just on first mount) so
  // an admin decision made while the app was backgrounded/on another screen
  // — e.g. a bank-detail rejection — shows up on return instead of only
  // after a full app restart. Pull-to-refresh below covers the case where
  // the user is already sitting on this screen when the decision happens.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (error)
    return (
      <Screen>
        <ErrorState message={error} />
      </Screen>
    );
  if (!data)
    return (
      <Screen>
        <View style={styles.pad}>
          <AppText>Loading…</AppText>
        </View>
      </Screen>
    );
  if (!data.enabled) {
    return (
      <Screen>
        <View style={styles.pad}>
          <AppText variant="title">Business Associate</AppText>
          <AppText color="secondary">This programme is not active yet.</AppText>
        </View>
      </Screen>
    );
  }

  const fs = data.profile?.frontendStatus ?? "NOT_REGISTERED";
  // See apps/web/src/app/account/ba/page.tsx's identical bankRejected
  // override — bank-detail status is tracked separately from
  // frontendStatus, so a BA can be permanently "APPROVED" while a later
  // bank-detail resubmission gets rejected.
  const bankRejected = data.profile?.bankStatus === "REJECTED";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <AppText variant="title">Business Associate</AppText>
        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="label" color="secondary">
            Status
          </AppText>
          <AppText variant="subtitle">
            {bankRejected ? "Bank details rejected" : STATUS_LABEL[fs]}
          </AppText>
          {fs === "REJECTED" && data.profile?.rejectedReason ? (
            <AppText color="secondary">Reason: {data.profile.rejectedReason}</AppText>
          ) : null}
          {bankRejected && data.profile?.bankRejectionReason ? (
            <AppText color="secondary">Reason: {data.profile.bankRejectionReason}</AppText>
          ) : null}
        </View>

        {data.profile && (fs === "APPROVED" || fs === "APPROVED_NO_BANK") ? (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <AppText variant="label" color="secondary">
              Your referral code
            </AppText>
            <AppText variant="title">{data.profile.referralCode}</AppText>
            <AppText variant="label" color="secondary" style={{ marginTop: Spacing.xs }}>
              {referralUrl(data.profile.referralCode)}
            </AppText>
            <Button
              label="Share referral link"
              onPress={() => shareReferral(data.profile!.referralCode)}
              fullWidth
            />
            <AppText variant="label" color="secondary">
              Opens WhatsApp, X, Instagram, Telegram, copy link and more. The link opens this app on
              a phone that has it installed.
            </AppText>
          </View>
        ) : null}

        {data.profile && (fs === "APPROVED" || fs === "APPROVED_NO_BANK") ? (
          <View style={styles.actionGrid}>
            <Button
              label="Your referrals"
              variant="outline"
              onPress={() => router.push("/(app)/more/ba-referees" as never)}
              fullWidth
            />
            <Button
              label="Referral orders"
              variant="outline"
              onPress={() => router.push("/(app)/more/ba-referee-orders" as never)}
              fullWidth
            />
          </View>
        ) : null}

        {data.wallet ? (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <AppText variant="subtitle">Earnings</AppText>
            <Row label="Total earned" value={data.wallet.totalEarned} />
            <Row label="Redeemable now" value={data.wallet.eligible} highlight />
            <Row label="Locked (pending order)" value={data.wallet.lockedPending} />
            <Row label="Already paid out" value={data.wallet.settled} />
            {data.wallet.reversed > 0 ? (
              <Row label="Reversed" value={data.wallet.reversed} />
            ) : null}
          </View>
        ) : null}

        {data.pendingApprovals.length > 0 ? (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <AppText variant="subtitle">Orders waiting for your approval</AppText>
            {data.pendingApprovals.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                label={`₹${p.grandTotal.toFixed(2)} · ${p.itemCount} item(s)`}
                onPress={() => router.push(`/(app)/more/ba-order/${p.id}` as never)}
              />
            ))}
          </View>
        ) : null}

        {fs === "NOT_REGISTERED" || fs === "REJECTED" ? (
          <BasicDetailsForm profile={data.profile} onSubmitted={() => void load()} />
        ) : null}

        {data.profile && (fs === "APPROVED_NO_BANK" || fs === "APPROVED") ? (
          <BankDetailsForm profile={data.profile} onSaved={() => void load()} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText color="secondary">{label}</AppText>
      <AppText variant={highlight ? "subtitle" : "body"}>₹{value.toFixed(2)}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.lg, gap: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionGrid: { gap: Spacing.sm },
});
