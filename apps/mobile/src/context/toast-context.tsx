import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

/**
 * The toast/snackbar the web storefront lacks (base spec §13.1 flags its
 * feedback model as "thin" — inline button state + cart badge only). One
 * lightweight bottom toast: `toast.show("Added to cart")` /
 * `toast.error(msg)`. Auto-dismisses; a new call replaces the current one.
 */

type ToastKind = "info" | "success" | "error";
type ToastCtx = {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);
const DURATION_MS = 2600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(() =>
      setToast(null),
    );
  }, [opacity]);

  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, kind });
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, DURATION_MS);
    },
    [opacity, hide],
  );

  const value = useMemo<ToastCtx>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
    }),
    [show],
  );

  const bg =
    toast?.kind === "error"
      ? theme.danger
      : toast?.kind === "success"
        ? theme.green700
        : theme.ink;
  const icon =
    toast?.kind === "error"
      ? "alert-circle"
      : toast?.kind === "success"
        ? "checkmark-circle"
        : "information-circle";

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            { backgroundColor: bg, opacity, bottom: insets.bottom + 78 },
          ]}
        >
          <Ionicons name={icon} size={16} color={theme.onGreen} />
          <AppText color="white" variant="bodyBold" style={styles.text} numberOfLines={2}>
            {toast.message}
          </AppText>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
  },
  text: { flex: 1 },
});
