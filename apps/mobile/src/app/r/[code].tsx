import { useEffect } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Screen } from "@/components/ui";

/**
 * Deep-link target for a Business Associate referral link:
 *   https://<host>/r/<CODE>   (Android App Link / iOS Universal Link)
 *   kisan4u://r/<CODE>        (custom scheme, in-app share)
 *
 * Captures the code and forwards to the customer sign-in screen with it
 * pre-filled; it is applied to a brand-new account on OTP verify.
 */
export default function ReferralDeepLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();

  useEffect(() => {
    const clean = (code ?? "").trim().toUpperCase().slice(0, 16);
    const valid = /^BA-[0-9A-F]{12}$/.test(clean);
    router.replace({
      pathname: "/(auth)/customer-login",
      params: valid ? { ref: clean } : {},
    });
  }, [code]);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <AppText color="secondary">Opening…</AppText>
      </View>
    </Screen>
  );
}
