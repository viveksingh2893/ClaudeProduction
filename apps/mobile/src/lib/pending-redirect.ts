import * as SecureStore from "expo-secure-store";

const KEY = "kisan4u.pendingRedirect";
const AFTER_PROFILE_KEY = "kisan4u.afterProfileRedirect";
const ALLOWED = new Set([
  "/(app)/more/business-associate",
  "/(app)/become-dealer",
  "/(app)/complete-profile",
]);

export type PendingRedirect =
  "/(app)/more/business-associate" | "/(app)/become-dealer" | "/(app)/complete-profile";

export function isAllowedPendingRedirect(value: unknown): value is PendingRedirect {
  return typeof value === "string" && ALLOWED.has(value);
}

export async function savePendingRedirect(value: unknown): Promise<void> {
  if (isAllowedPendingRedirect(value)) await SecureStore.setItemAsync(KEY, value);
}

export async function consumePendingRedirect(): Promise<PendingRedirect | null> {
  const value = await SecureStore.getItemAsync(KEY);
  await SecureStore.deleteItemAsync(KEY);
  return isAllowedPendingRedirect(value) ? value : null;
}

export async function routeNewAccountThroughProfile(): Promise<void> {
  const current = await SecureStore.getItemAsync(KEY);
  if (isAllowedPendingRedirect(current) && current !== "/(app)/complete-profile") {
    await SecureStore.setItemAsync(AFTER_PROFILE_KEY, current);
  }
  await SecureStore.setItemAsync(KEY, "/(app)/complete-profile");
}

export async function consumeAfterProfileRedirect(): Promise<PendingRedirect | null> {
  const value = await SecureStore.getItemAsync(AFTER_PROFILE_KEY);
  await SecureStore.deleteItemAsync(AFTER_PROFILE_KEY);
  return isAllowedPendingRedirect(value) && value !== "/(app)/complete-profile" ? value : null;
}
