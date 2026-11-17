import { useEffect, useState } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";
import { APP_COLOR_SCHEME } from "@/constants/theme";

/**
 * Web variant — same `APP_COLOR_SCHEME` override as the native hook, with
 * a hydration guard so static rendering doesn't mismatch the client.
 */
export function useColorScheme(): "light" | "dark" {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const device = useRNColorScheme();

  if (APP_COLOR_SCHEME) return APP_COLOR_SCHEME;
  if (hasHydrated) return device === "dark" ? "dark" : "light";
  return "light";
}
