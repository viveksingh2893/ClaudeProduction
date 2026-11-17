import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { consumePendingRedirect, type PendingRedirect } from "@/lib/pending-redirect";

export default function AuthLayout() {
  const { status, isGuest } = useAuth();
  const theme = useTheme();
  const [redirectTo, setRedirectTo] = useState<PendingRedirect | "/(app)/(tabs)" | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || isGuest) {
      setRedirectTo(null);
      return;
    }
    void consumePendingRedirect().then((pending) => setRedirectTo(pending ?? "/(app)/(tabs)"));
  }, [isGuest, status]);

  // A guest is technically "authenticated" (guest bearer token), but the
  // whole point of these screens is to let a guest upgrade to a real
  // account — so only bounce a *real* signed-in user back to the app.
  if (status === "authenticated" && !isGuest) {
    return redirectTo ? <Redirect href={redirectTo as never} /> : null;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.ink,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800" },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="customer-login" options={{ title: "Log in" }} />
      <Stack.Screen name="otp" options={{ title: "Verify OTP" }} />
      <Stack.Screen name="seller-login" options={{ title: "Seller login" }} />
      <Stack.Screen name="dealer-register/index" options={{ title: "Dealer registration" }} />
      <Stack.Screen name="dealer-register/otp" options={{ title: "Verify OTP" }} />
      <Stack.Screen name="dealer-register/details" options={{ title: "Business details" }} />
      <Stack.Screen name="dealer-register/status" options={{ title: "Application status" }} />
    </Stack>
  );
}
