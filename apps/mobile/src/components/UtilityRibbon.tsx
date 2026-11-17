import { useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LANGUAGES, languageMeta, type LanguageCode } from "@kisan4u/validators";
import { AppText } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useLanguage } from "@/context/language-context";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

/**
 * The slim green utility bar from the top of every storefront page
 * (apps/web/src/components/promo-header.tsx) — language switcher on the
 * left, "Become a Dealer" and "Corporate Website" on the right. Mounted at
 * the top of the app's main screens.
 */

const CORPORATE_WEBSITE_URL = "https://corporate.kisan4u.com/";

export function UtilityRibbon() {
  const theme = useTheme();
  const { lang, setLang, t } = useLanguage();
  const { user, isGuest, dealerApplication } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  const current = languageMeta(lang);
  const currentLabel = current.code === "en" ? current.label : current.nativeLabel;

  // "Become a Dealer" pill: shown only to an ordinary signed-in customer.
  // An approved dealer (role DEALER) and a not-yet-verified guest never
  // see it; a customer mid-application sees the status instead. Tapping it
  // opens the in-app application form — never the signed-out /dealer-register
  // OTP flow, which just bounces an authenticated user home.
  const isDealer = user?.role === "DEALER";
  const showDealerPill = Boolean(user) && !isGuest && !isDealer;
  const dealerPillLabel =
    dealerApplication?.status === "PENDING"
      ? "Pending approval"
      : dealerApplication?.status === "REJECTED"
        ? "Application rejected"
        : t("ribbon.becomeDealer");

  function choose(code: LanguageCode) {
    setLang(code);
    setPickerOpen(false);
  }

  return (
    <View style={[styles.bar, { backgroundColor: theme.green800 }]}>
      <Pressable
        style={styles.langChip}
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("ribbon.chooseLanguage")}
        hitSlop={6}
      >
        <Ionicons name="globe-outline" size={13} color={theme.onGreen} />
        <AppText style={[styles.langText, { color: theme.onGreen }]} numberOfLines={1}>
          {currentLabel}
        </AppText>
        <Ionicons name="chevron-down" size={11} color="rgba(255,255,255,0.85)" />
      </Pressable>

      <View style={styles.right}>
        {showDealerPill && (
          <Pressable
            style={[styles.pillSolid, { backgroundColor: theme.onGreen }]}
            onPress={() => router.push("/(app)/become-dealer")}
            accessibilityRole="button"
          >
            <AppText style={[styles.pillSolidText, { color: theme.green800 }]} numberOfLines={1}>
              {dealerPillLabel}
            </AppText>
          </Pressable>
        )}
        <Pressable
          style={styles.pillOutline}
          onPress={() => Linking.openURL(CORPORATE_WEBSITE_URL).catch(() => {})}
          accessibilityRole="button"
        >
          <AppText style={[styles.pillOutlineText, { color: theme.onGreen }]} numberOfLines={1}>
            {t("ribbon.corporateWebsite")}
          </AppText>
          <Ionicons name="open-outline" size={11} color={theme.onGreen} />
        </Pressable>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <AppText variant="subtitle" style={styles.sheetTitle}>
              {t("ribbon.chooseLanguage")}
            </AppText>
            {LANGUAGES.map((l) => {
              const selected = l.code === lang;
              return (
                <Pressable
                  key={l.code}
                  style={[
                    styles.langRow,
                    { borderColor: selected ? theme.green700 : theme.border },
                    selected && { backgroundColor: theme.green50 },
                  ]}
                  onPress={() => choose(l.code)}
                >
                  <AppText variant="body" color={selected ? "green" : "ink"}>
                    {l.nativeLabel}
                    {l.code !== "en" ? `  ·  ${l.label}` : ""}
                  </AppText>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={18} color={theme.green700} />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  langChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 1,
  },
  langText: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  pillSolid: {
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillSolidText: { fontSize: 11, fontWeight: "800" },
  pillOutline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.6)",
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillOutlineText: { fontSize: 11, fontWeight: "800" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sheetTitle: { marginBottom: Spacing.xs },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
