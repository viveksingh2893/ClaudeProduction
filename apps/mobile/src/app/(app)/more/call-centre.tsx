import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getSiteSettings } from "@/lib/api/site-settings";
import { Spacing } from "@/constants/theme";

/**
 * A formal call-centre / lead-management panel doesn't exist anywhere in
 * the backend (see the mobile-app audit) — this is the one real, low-risk
 * piece available today: the admin-configured customer-care number
 * (SiteSettings.footerCustomerCareNumber), same as the website's footer.
 * No fabricated phone number — if the admin hasn't set one, this simply
 * says so instead of making one up.
 */
export default function CallCentreScreen() {
  const theme = useTheme();
  const [phone, setPhone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSiteSettings().then((result) => {
      setLoaded(true);
      if (result.ok) setPhone(result.data.footerCustomerCareNumber);
    });
  }, []);

  return (
    <Screen>
      <View style={styles.container}>
        <Ionicons name="call" size={48} color={theme.info} />
        <AppText variant="title">Talk to us</AppText>
        {!loaded ? null : phone ? (
          <>
            <AppText variant="body" color="secondary" style={styles.center}>
              Our support line is available for order help, complaints, and general questions.
            </AppText>
            <Button
              label={`Call ${phone}`}
              onPress={() => Linking.openURL(`tel:${phone}`)}
              fullWidth
            />
            <Button
              label="Chat on WhatsApp"
              variant="secondary"
              onPress={() => Linking.openURL(`https://wa.me/${phone.replace(/\D/g, "")}`)}
              fullWidth
            />
          </>
        ) : (
          <AppText variant="body" color="secondary" style={styles.center}>
            Support contact details haven&apos;t been configured yet. Please check back soon.
          </AppText>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  center: { textAlign: "center" },
});
