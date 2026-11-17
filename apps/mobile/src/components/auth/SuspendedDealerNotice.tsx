import { Linking, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { ApiError } from "@/lib/api-client";
import { Radius, Spacing } from "@/constants/theme";

export const DEALER_SUSPENDED_CODE = "DEALER_SUSPENDED";

/** The support number the server attached to a DEALER_SUSPENDED error, if the admin configured one. */
export function suspendedSupportPhone(error: ApiError): string | null {
  const phone = error.details?.supportPhone;
  return typeof phone === "string" && phone.length > 0 ? phone : null;
}

/**
 * Shown on the login / dealer-registration screens when the phone number
 * belongs to a SUSPENDED dealer — the server refuses to send an OTP, so
 * this tells them why and gives them the support number to call.
 */
export function SuspendedDealerNotice({ error }: { error: ApiError }) {
  const theme = useTheme();
  const phone = suspendedSupportPhone(error);
  return (
    <View style={[styles.box, { backgroundColor: theme.dangerBg, borderColor: theme.danger }]}>
      <View style={styles.row}>
        <Ionicons name="alert-circle" size={22} color={theme.danger} />
        <AppText variant="bodyBold" color="danger" style={styles.title}>
          Account suspended
        </AppText>
      </View>
      <AppText variant="body">{error.message}</AppText>
      {phone ? (
        <Button
          label={`Call support ${phone}`}
          onPress={() => Linking.openURL(`tel:${phone}`)}
          fullWidth
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  title: { flex: 1 },
});
