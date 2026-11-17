import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { requestCustomerOtp } from "@/lib/api/auth";
import type { ApiError } from "@/lib/api-client";
import {
  DEALER_SUSPENDED_CODE,
  SuspendedDealerNotice,
} from "@/components/auth/SuspendedDealerNotice";
import { Spacing } from "@/constants/theme";

export default function CustomerLoginScreen() {
  const { ref, notice, next } = useLocalSearchParams<{
    ref?: string;
    notice?: string;
    next?: string;
  }>();
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState((ref ?? "").toUpperCase());
  const [error, setError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    setError(null);
    setSuspended(null);
    setLoading(true);
    const result = await requestCustomerOtp(phone.trim());
    setLoading(false);
    if (!result.ok) {
      if (result.error.code === DEALER_SUSPENDED_CODE) setSuspended(result.error);
      else setError(result.error.message);
      return;
    }
    router.push({
      pathname: "/(auth)/otp",
      params: {
        phone: result.data.phone,
        mode: "login",
        ref: referralCode.trim() || undefined,
        next: next || undefined,
      },
    });
  }

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="subtitle">Enter your mobile number</AppText>
        <AppText variant="body" color="secondary">
          We&apos;ll send a one-time code to verify it&apos;s you. New here? We&apos;ll set up your
          account automatically.
        </AppText>
        {notice === "otp-attempts" ? (
          <AppText variant="body" color="danger">
            Too many incorrect OTP attempts. Request a new code to try again.
          </AppText>
        ) : null}
        <TextField
          label="Mobile number"
          keyboardType="phone-pad"
          autoFocus
          maxLength={10}
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            setSuspended(null);
          }}
          placeholder="10-digit mobile number"
          error={error}
        />
        {suspended ? <SuspendedDealerNotice error={suspended} /> : null}
        <TextField
          label="Referral code (optional)"
          autoCapitalize="characters"
          value={referralCode}
          onChangeText={(v) => setReferralCode(v.toUpperCase())}
          placeholder="BA-A1B2C3D4E5F6"
        />
        <Button
          label="Send OTP"
          onPress={handleContinue}
          loading={loading}
          disabled={phone.trim().length < 10}
          fullWidth
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ container: { padding: Spacing.xl, gap: Spacing.md } });
