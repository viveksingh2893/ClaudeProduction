import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, Badge, Button, Screen } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { Spacing } from "@/constants/theme";

export default function SellerPendingScreen() {
  const { sellerStatus, logout, refreshProfile } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/welcome");
  }

  return (
    <Screen>
      <View style={styles.container}>
        <Badge label={sellerStatus?.status ?? "PENDING"} tone={sellerStatus?.status === "REJECTED" ? "danger" : "warning"} />
        <AppText variant="title">
          {sellerStatus?.status === "REJECTED" ? "Application rejected" : "Application under review"}
        </AppText>
        <AppText variant="body" color="secondary">
          {sellerStatus?.rejectionReason ?? "Our team is reviewing your seller application. You'll be notified once approved."}
        </AppText>
        <Button label="Refresh status" onPress={refreshProfile} variant="outline" fullWidth />
        <Button label="Log out" onPress={handleLogout} variant="ghost" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ container: { padding: Spacing.xl, gap: Spacing.sm } });
