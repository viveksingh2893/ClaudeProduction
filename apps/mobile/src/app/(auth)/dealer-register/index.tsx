import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { requestDealerRegistrationOtp } from "@/lib/api/dealer";
import type { ApiError } from "@/lib/api-client";
import {
  DEALER_SUSPENDED_CODE,
  SuspendedDealerNotice,
} from "@/components/auth/SuspendedDealerNotice";
import { Spacing } from "@/constants/theme";

export default function DealerRegisterStartScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    setError(null);
    setSuspended(null);
    setLoading(true);
    const result = await requestDealerRegistrationOtp(phone.trim());
    setLoading(false);
    if (!result.ok) {
      if (result.error.code === DEALER_SUSPENDED_CODE) setSuspended(result.error);
      else setError(result.error.message);
      return;
    }
    if (result.data.alreadyDealer) {
      router.push({
        pathname: "/(auth)/otp",
        params: { phone: result.data.phone, role: "DEALER", mode: "login" },
      });
      return;
    }
    router.push({ pathname: "/(auth)/dealer-register/otp", params: { phone: result.data.phone } });
  }

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="subtitle">Register as a dealer</AppText>
        <AppText variant="body" color="secondary">
          Bulk pricing, minimum-order quantities, and state-wise availability — built for your
          business.
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
