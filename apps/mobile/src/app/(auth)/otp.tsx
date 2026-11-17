import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { verifyOtp, requestCustomerOtp } from "@/lib/api/auth";
import { useAuth } from "@/context/auth-context";
import { Spacing } from "@/constants/theme";
import { OtpExpiredNotice, OtpResendButton } from "@/components/auth/OtpResendButton";
import { otpRetryAfter, useOtpFailureCounter, useOtpTimers } from "@/hooks/use-otp-timers";
import { routeNewAccountThroughProfile } from "@/lib/pending-redirect";

export default function OtpScreen() {
  const { phone, ref, next } = useLocalSearchParams<{
    phone: string;
    ref?: string;
    next?: string;
  }>();
  const { completeLogin } = useAuth();
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
      const result = await verifyOtp({
        phone,
        code: value,
        referralCode: (ref ?? "").trim() || undefined,
      });
      setLoading(false);
      if (!result.ok) {
        submittedFor.current = null;
        const attemptsLeft = recordFailure();
        if (attemptsLeft === 0) {
          router.replace({
            pathname: "/(auth)/customer-login",
            params: { notice: "otp-attempts", ref: ref || undefined, next: next || undefined },
          });
          return;
        }
        setCode("");
        setError(
          `${result.error.message} ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
        );
        return;
      }
      if (result.data.isNewAccount && !result.data.user.firstName) {
        await routeNewAccountThroughProfile();
      }
      await completeLogin(result.data, result.data.user);
    },
    [code, loading, phone, ref, next, completeLogin, recordFailure, timers.expired],
  );

  // When the 6 digits arrive from Android's SMS autofill (or the shopper
  // finishes typing), submit without a manual "Verify" tap — the closest
  // thing to "OTP taken from the message" without an SMS-read permission /
  // an app-hash suffix on the DLT template.
  useEffect(() => {
    const value = code.trim();
    if (value.length === 6 && submittedFor.current !== value && !loading) {
      submittedFor.current = value;
      void handleVerify(value);
    }
  }, [code, loading, handleVerify]);

  async function handleResend() {
    setResending(true);
    setError(null);
    const result = await requestCustomerOtp(phone);
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
          label="Verify & Continue"
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

const styles = StyleSheet.create({
  container: { padding: Spacing.xl, gap: Spacing.md },
});
