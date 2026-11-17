import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, Button, Screen } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { restoreDeletedAccount } from "@/lib/api/account-deletion";
import { Spacing } from "@/constants/theme";

export default function AccountDeletionPendingScreen() {
  const { user, logout } = useAuth();
  const toast = useToast();

  async function restore() {
    const result = await restoreDeletedAccount();
    if (!result.ok) return toast.error(result.error.message);
    await logout();
    router.replace("/(auth)/welcome");
  }

  async function signOut() {
    await logout();
    router.replace("/(auth)/welcome");
  }

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="title">Account deletion pending</AppText>
        <AppText variant="body" color="secondary">
          {user?.deletionScheduledFor
            ? `Your account is scheduled for deletion on ${new Date(user.deletionScheduledFor).toLocaleDateString()}.`
            : "Your request is waiting for administrator review."}
        </AppText>
        <AppText variant="body" color="secondary">Restore your account to continue shopping and using Kisan4U.</AppText>
        <Button label="Restore account" onPress={restore} fullWidth />
        <Button label="Log out" variant="outline" onPress={signOut} fullWidth />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: Spacing.xl, gap: Spacing.md },
});
