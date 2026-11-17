import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, Button, TextField } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useCart } from "@/context/cart-context";
import { useT } from "@/context/language-context";
import { requestCustomerOtp, verifyOtp } from "@/lib/api/auth";
import { Spacing } from "@/constants/theme";
import { OtpExpiredNotice, OtpResendButton } from "@/components/auth/OtpResendButton";
import { otpRetryAfter, useOtpFailureCounter, useOtpTimers } from "@/hooks/use-otp-timers";

type Props = {
  phone: string;
  name: string;
  onChangePhone: (phone: string) => void;
};

/** Inline guest verification embedded beside the checkout address mobile field. */
export function GuestVerifyGate({ phone, name, onChangePhone }: Props) {
  const { completeLogin } = useAuth();
  const { refresh: refreshCart } = useCart();
  const t = useT();
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedFor = useRef<string | null>(null);
  const timers = useOtpTimers({ autoStart: false });
  const { recordFailure, resetFailures } = useOtpFailureCounter();

  async function handleSendOtp() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      setError(t("checkout.invalidMobile"));
      return;
    }
    setSending(true);
    setError(null);
    const res = await requestCustomerOtp(digits, "guest_checkout");
    setSending(false);
    if (!res.ok) {
      const retryAfter = otpRetryAfter(res.error.details);
      if (retryAfter) timers.limitResend(retryAfter);
      setError(res.error.message);
      return;
    }
    setCode("");
    submittedFor.current = null;
    resetFailures();
    setStep("otp");
    timers.restart();
  }

  const handleVerify = useCallback(
    async (submitCode?: string) => {
      const value = (submitCode ?? code).trim();
      if (value.length !== 6 || verifying || timers.expired) return;
      setVerifying(true);
      setError(null);
      const res = await verifyOtp({
        phone: phone.replace(/\D/g, ""),
        code: value,
        purpose: "guest_checkout",
        name: name.trim() || undefined,
      });
      setVerifying(false);
      if (!res.ok) {
        submittedFor.current = null;
        const attemptsLeft = recordFailure();
        if (attemptsLeft === 0) {
          setStep("phone");
          setCode("");
          timers.stop();
          resetFailures();
          setError(t("checkout.tooManyOtpAttempts"));
          return;
        }
        setCode("");
        setError(`${res.error.message} ${t("checkout.otpAttemptsLeft", { count: attemptsLeft })}`);
        return;
      }

      await completeLogin(res.data, res.data.user);
      if (res.data.user.role === "DEALER") {
        // The server already discarded this guest cart when the OTP
        // resolved to a dealer account — force the badge/cart views to
        // pick that up immediately instead of waiting on the next
        // user-id-changed effect, so the redirected-to Home never flashes
        // the old guest count.
        void refreshCart();
        router.replace("/(app)/(tabs)" as never);
      }
    },
    [
      code,
      verifying,
      timers,
      phone,
      name,
      recordFailure,
      resetFailures,
      t,
      completeLogin,
      refreshCart,
    ],
  );

  async function handleResend() {
    setSending(true);
    setError(null);
    const res = await requestCustomerOtp(phone.replace(/\D/g, ""), "guest_checkout");
    setSending(false);
    if (!res.ok) {
      const retryAfter = otpRetryAfter(res.error.details);
      if (retryAfter) timers.limitResend(retryAfter);
      setError(res.error.message);
      return;
    }
    setCode("");
    submittedFor.current = null;
    resetFailures();
    timers.restart();
  }

  function resetToPhone(clearPhone = false) {
    setStep("phone");
    setCode("");
    setError(null);
    submittedFor.current = null;
    timers.stop();
    resetFailures();
    if (clearPhone) onChangePhone("");
  }

  useEffect(() => {
    const value = code.trim();
    if (step === "otp" && value.length === 6 && submittedFor.current !== value && !verifying) {
      submittedFor.current = value;
      void handleVerify(value);
    }
  }, [code, step, verifying, handleVerify]);

  return (
    <View style={styles.container}>
      <View style={styles.phoneRow}>
        <View style={styles.phoneField}>
          <TextField
            label={t("checkout.mobileNumber")}
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={(value) => onChangePhone(value.replace(/\D/g, ""))}
            placeholder={t("checkout.mobilePlaceholder")}
            textContentType="telephoneNumber"
            autoComplete="tel"
            editable={step === "phone"}
          />
        </View>
        {step === "phone" ? (
          <View style={styles.verifyButton}>
            <Button
              label={t("checkout.verifyMobile")}
              variant="secondary"
              onPress={handleSendOtp}
              loading={sending}
              disabled={phone.replace(/\D/g, "").length !== 10}
            />
          </View>
        ) : null}
      </View>

      {step === "otp" ? (
        <View style={styles.otpBlock}>
          {timers.expired ? (
            <OtpExpiredNotice />
          ) : (
            <AppText variant="caption" color="secondary">
              {t("checkout.otpSent", { phone })}
            </AppText>
          )}
          <TextField
            label={t("checkout.otpCode")}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, ""))}
            placeholder="000000"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            importantForAutofill="yes"
            editable={!timers.expired}
          />
          <Button
            label={t("checkout.verifyContinue")}
            onPress={() => handleVerify()}
            loading={verifying}
            disabled={code.trim().length !== 6 || timers.expired}
            fullWidth
          />
          <OtpResendButton resendIn={timers.resendIn} onResend={handleResend} pending={sending} />
          <Button
            label={t("checkout.changeNumber")}
            variant="ghost"
            onPress={() => resetToPhone()}
          />
        </View>
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  phoneRow: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm },
  phoneField: { flex: 1 },
  verifyButton: { paddingBottom: 2 },
  otpBlock: { gap: Spacing.sm },
});
