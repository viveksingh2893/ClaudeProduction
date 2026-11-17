import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { loginWithPassword } from "@/lib/api/auth";
import { useAuth } from "@/context/auth-context";
import { Spacing } from "@/constants/theme";

export default function SellerLoginScreen() {
  const { completeLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    const result = await loginWithPassword(email.trim(), password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await completeLogin(result.data, result.data.user);
  }

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="subtitle">Seller login</AppText>
        <AppText variant="body" color="secondary">
          Use the same email and password as your seller panel account.
        </AppText>
        <TextField
          label="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
        />
        <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" />
        {error ? (
          <AppText variant="body" color="danger">
            {error}
          </AppText>
        ) : null}
        <Button label="Log in" onPress={handleLogin} loading={loading} disabled={!email || !password} fullWidth />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ container: { padding: Spacing.xl, gap: Spacing.md } });
