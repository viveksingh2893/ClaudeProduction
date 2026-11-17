import * as SecureStore from "expo-secure-store";

/**
 * All auth tokens live in the OS keystore/keychain (expo-secure-store),
 * never AsyncStorage/plain files — the one place the APK is allowed to
 * hold long-lived credentials at all, and it never sees the DB or any
 * server secret, only its own short-lived bearer tokens (see
 * packages/auth/src/mobile-tokens.ts).
 */
const ACCESS_TOKEN_KEY = "kisan4u.accessToken";
const REFRESH_TOKEN_KEY = "kisan4u.refreshToken";

export async function getStoredTokens(): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
