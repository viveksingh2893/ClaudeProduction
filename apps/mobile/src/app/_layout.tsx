import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { LanguageProvider } from "@/context/language-context";
import { CategoriesProvider } from "@/context/categories-context";
import { CartProvider } from "@/context/cart-context";
import { ToastProvider } from "@/context/toast-context";
import { SplashReadyProvider, useSplashReady } from "@/context/splash-ready-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useNotificationObserver } from "@/lib/push";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { status } = useAuth();
  const { welcomeReady } = useSplashReady();
  useNotificationObserver();

  useEffect(() => {
    if (status === "authenticated" || (status === "unauthenticated" && welcomeReady)) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [status, welcomeReady]);

  if (status === "loading") return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  // Follows the resolved app scheme (currently forced light — see
  // APP_COLOR_SCHEME), so the status bar icons stay legible if that flips.
  const scheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LanguageProvider>
          <SplashReadyProvider>
            <AuthProvider>
              <CategoriesProvider>
                <CartProvider>
                  <ToastProvider>
                    <StatusBar style={scheme === "dark" ? "light" : "dark"} />
                    <RootNavigator />
                  </ToastProvider>
                </CartProvider>
              </CategoriesProvider>
            </AuthProvider>
          </SplashReadyProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
