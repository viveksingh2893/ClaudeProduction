import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { verifyDealerRegistrationOtp, requestDealerRegistrationOtp } from "@/lib/api/dealer";
import { Spacing } from "@/constants/theme";
import { OtpExpiredNotice, OtpResendButton } from "@/components/auth/OtpResendButton";
import { otpRetryAfter, useOtpFailureCounter, useOtpTimers } from "@/hooks/use-otp-timers";

export default function DealerRegisterOtpScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const submittedFor = useRef<string | null>(null);
  const timers = useOtpTimers();
  const { recordFailure } = useOtpFailureCounter();

  const handleVerify = useCallback(
    async (submitCode?: string) => {
      const value = (submitCode ?? code).trim();
      if (value.length < 6 || loading || timers.expired) return;
      setError(null);
      setLoading(true);
      const result = await verifyDealerRegistrationOtp(phone, value);
      setLoading(false);
      if (!result.ok) {
        submittedFor.current = null;
        const attemptsLeft = recordFailure();
        if (attemptsLeft === 0) {
          router.replace({
            pathname: "/(auth)/dealer-register",
            params: { notice: "otp-attempts" },
          });
          return;
        }
        setCode("");
        setError(
          `${result.error.message} ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
        );
        return;
      }
      if (result.data.alreadyDealer) {
        router.push({
          pathname: "/(auth)/otp",
          params: { phone: result.data.phone ?? phone, role: "DEALER", mode: "login" },
        });
        return;
      }
      router.push({
        pathname: "/(auth)/dealer-register/details",
        params: { onboardingSessionId: result.data.onboardingSessionId! },
      });
    },
    [code, loading, phone, recordFailure, timers.expired],
  );

  async function handleResend() {
    setResending(true);
    setError(null);
    const result = await requestDealerRegistrationOtp(phone);
    setResending(false);
    if (!result.ok) {
      const retryAfter = otpRetryAfter(result.error.details);
      if (retryAfter) timers.limitResend(retryAfter);
      setError(result.error.message);
      return;
    }
    setCode("");
    submittedFor.current = null;
    timers.restart();
  }

  // Auto-submit once Android's SMS autofill fills the 6 digits.
  useEffect(() => {
    const value = code.trim();
    if (value.length === 6 && submittedFor.current !== value && !loading) {
      submittedFor.current = value;
      void handleVerify(value);
    }
  }, [code, loading, handleVerify]);

  return (
    <Screen>
      <View style={styles.container}>
        {timers.expired ? (
          <OtpExpiredNotice />
        ) : (
          <AppText variant="body" color="secondary">
            Code sent to <AppText variant="bodyBold">{phone}</AppText>
          </AppText>
        )}
        <TextField
          label="6-digit code"
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
          placeholder="000000"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          importantForAutofill="yes"
          editable={!timers.expired}
        />
        {error ? (
          <AppText variant="body" color="danger">
            {error}
          </AppText>
        ) : null}
        <Button
          label="Verify"
          onPress={() => handleVerify()}
          loading={loading}
          disabled={code.trim().length < 6 || timers.expired}
          fullWidth
        />
        <OtpResendButton resendIn={timers.resendIn} onResend={handleResend} pending={resending} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ container: { padding: Spacing.xl, gap: Spacing.md } });
