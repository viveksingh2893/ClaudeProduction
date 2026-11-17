import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LEGAL_LINKS } from "@kisan4u/validators";
import { AppText, Badge, Button, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/context/auth-context";
import { useT } from "@/context/language-context";
import { Radius, Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import { getFullName } from "@/lib/get-full-name";
import { getBaDashboard, type BaFrontendStatus } from "@/lib/api/ba";

const LEGAL_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  terms: "document-text-outline",
  privacy: "lock-closed-outline",
  "return-policy": "refresh-outline",
  "cancellation-policy": "close-circle-outline",
  "shipping-policy": "cube-outline",
  contact: "call-outline",
};

function PoliciesSection() {
  const t = useT();
  return (
    <View style={styles.section}>
      <AppText variant="label" color="secondary" style={styles.sectionLabel}>
        {t("account.policiesHelp")}
      </AppText>
      {LEGAL_LINKS.map((link) => (
        <MenuRow
          key={link.slug}
          icon={LEGAL_ICON[link.slug] ?? "document-text-outline"}
          label={link.label}
          onPress={() =>
            router.push({ pathname: "/(app)/legal/[slug]", params: { slug: link.slug } })
          }
        />
      ))}
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable style={[styles.row, { borderBottomColor: theme.border }]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={theme.textSecondary} />
      <AppText variant="body" style={styles.rowLabel}>
        {label}
      </AppText>
      {badge ? <Badge label={badge} tone="info" /> : null}
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

export default function AccountScreen() {
  const { user, isGuest, dealerStatus, sellerStatus, dealerApplication, logout } = useAuth();
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const containerPad = { paddingBottom: insets.bottom + TAB_BAR_SCENE_INSET };
  const userName = user && !isGuest ? getFullName(user) : null;

  // "Registered as BA" = actually approved (referral code live/usable) —
  // matches the web account page's identical rule. Fetched once, purely
  // for this menu row's label; no gating on program-enabled here since
  // the row itself is always shown regardless (pre-existing behavior).
  const [baStatus, setBaStatus] = useState<BaFrontendStatus | null>(null);
  useEffect(() => {
    if (isGuest || (user?.role !== "CUSTOMER" && user?.role !== "DEALER")) return;
    let alive = true;
    getBaDashboard().then((res) => {
      if (alive && res.ok && res.data.enabled)
        setBaStatus(res.data.profile?.frontendStatus ?? null);
    });
    return () => {
      alive = false;
    };
  }, [isGuest, user?.role]);
  const isActiveBa = baStatus === "APPROVED_NO_BANK" || baStatus === "APPROVED";

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/welcome");
  }

  if (isGuest) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={[styles.container, containerPad]}>
          <View style={styles.guestHeader}>
            <View style={[styles.guestAvatar, { backgroundColor: theme.green50 }]}>
              <Ionicons name="person-outline" size={30} color={theme.green700} />
            </View>
            <AppText variant="title">{t("account.guestTitle")}</AppText>
            <AppText variant="body" color="secondary" style={styles.center}>
              {t("account.guestBody")}
            </AppText>
          </View>
          <Button
            label={t("account.loginSignup")}
            onPress={() => router.push("/(auth)/welcome")}
            fullWidth
          />

          <View style={styles.section}>
            <AppText variant="label" color="secondary" style={styles.sectionLabel}>
              {t("account.moreFromKisan4u")}
            </AppText>
            <MenuRow
              icon="medkit-outline"
              label={t("account.doctor")}
              onPress={() => router.push("/(app)/(tabs)/doctor")}
              badge={t("account.comingSoon")}
            />
            <MenuRow
              icon="call-outline"
              label={t("account.talkToUs")}
              onPress={() => router.push("/(app)/more/call-centre")}
            />
          </View>

          <PoliciesSection />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={[styles.container, containerPad]}>
        <View>
          <AppText variant="title" color="green">
            {t("account.welcome")}
            {userName ? `, ${userName}` : ""}
          </AppText>
          <AppText variant="body" color="secondary">
            {t("account.loggedInAs", {
              role:
                user?.role === "DEALER"
                  ? t("account.roleDealer")
                  : user?.role === "SELLER"
                    ? t("account.roleSeller")
                    : t("account.roleCustomer"),
            })}
          </AppText>
        </View>

        {user?.role === "DEALER" && dealerStatus ? (
          <View style={[styles.statusCard, { backgroundColor: theme.earth100 }]}>
            <AppText variant="bodyBold" color="earth">
              {t("account.dealerStatus")}: {dealerStatus.status}
            </AppText>
          </View>
        ) : null}
        {user?.role === "SELLER" && sellerStatus ? (
          <View style={[styles.statusCard, { backgroundColor: theme.earth100 }]}>
            <AppText variant="bodyBold" color="earth">
              {t("account.sellerStatus")}: {sellerStatus.status}
            </AppText>
          </View>
        ) : null}

        {/* "Become a Dealer" — only an ordinary customer sees it. A pending
            or rejected application keeps the row (tap to review / edit /
            resubmit); an approved dealer has role DEALER and never lands here. */}
        {user?.role === "CUSTOMER" ? (
          <View style={styles.section}>
            <MenuRow
              icon="ribbon-outline"
              label={
                dealerApplication?.status === "PENDING"
                  ? t("account.dealerAppPending")
                  : dealerApplication?.status === "REJECTED"
                    ? t("account.dealerAppRejected")
                    : t("account.becomeDealer")
              }
              badge={
                dealerApplication?.status === "PENDING"
                  ? t("account.underReview")
                  : dealerApplication?.status === "REJECTED"
                    ? t("account.actionNeeded")
                    : undefined
              }
              onPress={() => router.push("/(app)/become-dealer")}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          {(user?.role === "CUSTOMER" || user?.role === "DEALER") && (
            <>
              <MenuRow
                icon="receipt-outline"
                label={t("account.myOrders")}
                onPress={() => router.push("/(app)/(tabs)/orders")}
              />
              <MenuRow
                icon="notifications-outline"
                label={t("account.notifications")}
                onPress={() => router.push("/(app)/notifications" as never)}
              />
              <MenuRow
                icon="wallet-outline"
                label={t("account.wallet")}
                onPress={() => router.push("/(app)/wallet")}
              />
              <MenuRow
                icon="location-outline"
                label={t("account.savedAddresses")}
                onPress={() => router.push("/(app)/addresses")}
              />
              <MenuRow
                icon="heart-outline"
                label={t("account.wishlist")}
                onPress={() => router.push("/(app)/wishlist")}
              />
            </>
          )}
          {user?.role === "DEALER" && (
            <MenuRow
              icon="document-text-outline"
              label={t("account.productRequests")}
              onPress={() => router.push("/(app)/dealer-requests")}
            />
          )}
        </View>

        <View style={styles.section}>
          <AppText variant="label" color="secondary" style={styles.sectionLabel}>
            {t("account.moreFromKisan4u")}
          </AppText>
          <MenuRow
            icon="medkit-outline"
            label={t("account.doctor")}
            onPress={() => router.push("/(app)/(tabs)/doctor")}
            badge={t("account.comingSoon")}
          />
          <MenuRow
            icon="people-outline"
            label={isActiveBa ? "BA Referral Code and Earnings" : t("account.businessAssociate")}
            onPress={() => router.push("/(app)/more/business-associate")}
          />
          <MenuRow
            icon="call-outline"
            label={t("account.talkToUs")}
            onPress={() => router.push("/(app)/more/call-centre")}
          />
        </View>

        <PoliciesSection />

        <View style={styles.dangerZone}>
          <Pressable
            style={[styles.dangerButton, { borderColor: theme.danger }]}
            onPress={() => router.push("/(app)/delete-account" as never)}
          >
            <Ionicons name="trash-outline" size={19} color={theme.danger} />
            <AppText variant="bodyBold" color="danger">
              {t("account.deleteAccount")}
            </AppText>
          </Pressable>

          <Pressable
            style={[styles.dangerButton, { borderColor: theme.danger }]}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={19} color={theme.danger} />
            <AppText variant="bodyBold" color="danger">
              {t("account.logOut")}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  guestHeader: { alignItems: "center", gap: Spacing.sm, paddingTop: Spacing.lg },
  guestAvatar: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  center: { textAlign: "center" },
  statusCard: { borderRadius: Radius.lg, padding: Spacing.md },
  section: { gap: 0 },
  sectionLabel: { marginBottom: Spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1 },
  dangerZone: { gap: Spacing.sm },
  dangerButton: {
    flexDirection: "row",
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
  },
});
