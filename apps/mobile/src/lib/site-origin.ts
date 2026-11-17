import Constants from "expo-constants";

export const SITE_ORIGIN = (
  process.env.EXPO_PUBLIC_SITE_ORIGIN ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  "https://katra4u.com"
).replace(/\/$/, "");

export function siteUrl(path: string): string {
  return new URL(path, `${SITE_ORIGIN}/`).toString();
}
