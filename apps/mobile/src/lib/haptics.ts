import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Small wrappers around expo-haptics so tap feedback is one call and can
 * never crash the UI (a device with the vibrator disabled, an emulator,
 * or a transient native error just no-ops). Android gets a short click;
 * the heavier notification/impact styles are reserved for confirmations.
 */
function safe(run: () => Promise<unknown>) {
  try {
    void run().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Light tick for a normal button / row / tab press. */
export function tapFeedback() {
  safe(() =>
    Platform.OS === "android"
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.selectionAsync(),
  );
}

/** Slightly firmer — for a primary action (Buy Now, Place Order). */
export function actionFeedback() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Success / error patterns for toasts and confirmations. */
export function successFeedback() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
export function errorFeedback() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
