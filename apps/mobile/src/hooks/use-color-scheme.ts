import { useColorScheme as useRNColorScheme } from "react-native";
import { APP_COLOR_SCHEME } from "@/constants/theme";

/**
 * The resolved app colour scheme: the `APP_COLOR_SCHEME` override when set
 * (currently `"light"`, to match the light-only web storefront), otherwise
 * the device's own setting. Everything themable reads this, not RN's raw
 * `useColorScheme`, so flipping the override in one place changes the app.
 */
export function useColorScheme(): "light" | "dark" {
  const device = useRNColorScheme();
  return APP_COLOR_SCHEME ?? (device === "dark" ? "dark" : "light");
}
