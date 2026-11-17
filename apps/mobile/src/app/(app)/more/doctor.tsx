import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";

/**
 * Kisan4U Doctor has no backend yet anywhere (not on the website, not in
 * admin, no data model) — see the mobile-app audit. This is a deliberate,
 * honest placeholder rather than invented AI/agronomist logic; wire it up
 * once the crop-diagnosis flow (photo upload → AI suggestion → agronomist
 * review) is actually built server-side.
 */
export default function DoctorPlaceholderScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <View style={styles.container}>
        <Ionicons name="medkit" size={48} color={theme.green600} />
        <AppText variant="title">Kisan4U Doctor</AppText>
        <AppText variant="body" color="secondary" style={styles.center}>
          Crop diagnosis and agronomist advice are coming soon. Upload a photo of your crop and get
          expert help — right from your phone.
        </AppText>
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
