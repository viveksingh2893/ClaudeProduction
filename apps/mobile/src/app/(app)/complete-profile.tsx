import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { api } from "@/lib/api-client";
import { consumeAfterProfileRedirect } from "@/lib/pending-redirect";
import { useAuth } from "@/context/auth-context";
import { Spacing } from "@/constants/theme";

export default function CompleteProfileScreen() {
  const { refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    const result = await api.patch<{ user: { firstName: string; lastName: string | null } }>(
      "/api/mobile/v1/auth/profile",
      { name },
    );
    setLoading(false);
    if (!result.ok) return setError(result.error.message);
    await refreshProfile();
    const next = await consumeAfterProfileRedirect();
    router.replace((next ?? "/(app)/(tabs)") as never);
  }

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="title">What should we call you?</AppText>
        <AppText color="secondary">
          Your mobile number is verified. Add your name to finish setting up your account.
        </AppText>
        <TextField label="Full name" value={name} onChangeText={setName} autoFocus error={error} />
        <Button
          label="Finish setup"
          onPress={submit}
          loading={loading}
          disabled={!name.trim()}
          fullWidth
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ container: { padding: Spacing.xl, gap: Spacing.md } });
