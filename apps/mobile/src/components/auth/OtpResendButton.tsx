import { StyleSheet, View } from "react-native";
import { AppText, Button } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatCountdown } from "@/hooks/use-otp-timers";
import { Radius, Spacing } from "@/constants/theme";

export function OtpResendButton({
  resendIn,
  onResend,
  pending,
}: {
  resendIn: number;
  onResend: () => void;
  pending?: boolean;
}) {
  if (resendIn > 0) {
    return (
      <AppText variant="caption" color="secondary" style={styles.center}>
        Resend OTP in {formatCountdown(resendIn)}
      </AppText>
    );
  }
  return (
    <View style={styles.buttonWrap}>
      <Button
        label={pending ? "Sending…" : "Resend OTP"}
        onPress={onResend}
        loading={pending}
        variant="ghost"
      />
    </View>
  );
}

export function OtpExpiredNotice() {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.warningBg, borderColor: theme.warning }]}>
      <AppText variant="bodyBold" style={{ color: theme.warning }}>
        OTP time up
      </AppText>
      <AppText variant="caption" style={{ color: theme.warning }}>
        This OTP has expired. Resend it to receive a new code.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  buttonWrap: { alignItems: "center" },
  notice: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
});
