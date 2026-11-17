import { useEffect } from "react";
import { InteractionManager, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { registerPushToken, unregisterPushToken } from "@/lib/api/notifications";

/**
 * Expo push wiring for the app. Everything here is best-effort and safe to
 * call unconditionally:
 *
 *   - On a simulator, or when notification permission is denied, or before
 *     the Expo project has push credentials (EAS projectId + FCM
 *     google-services), `registerForPushNotificationsAsync` just returns
 *     null and nothing else happens.
 *   - The token, once obtained, is POSTed to the backend so server-side
 *     order events / admin broadcasts can reach this device. It's also
 *     kept in-memory so logout can unregister it.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let currentToken: string | null = null;
let scheduledSync: ReturnType<typeof setTimeout> | null = null;
let scheduledInteraction: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

function resolveProjectId(): string | undefined {
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const fromEasConfig = (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
  return fromExtra ?? fromEasConfig;
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2B6B3D",
    }).catch(() => {});
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted;
  }
  if (!granted) return null;

  try {
    const projectId = resolveProjectId();
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return result.data;
  } catch {
    // No EAS projectId / FCM not configured yet — expected until creds land.
    return null;
  }
}

/** Called once a real (non-guest) session is established. */
export async function syncPushToken(): Promise<void> {
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    currentToken = token;
    await registerPushToken(token, Platform.OS === "ios" ? "ios" : "android");
  } catch {
    /* best-effort */
  }
}

/**
 * Push registration can wake Google Play Services and show the Android 13
 * permission UI. Doing that during the first authenticated Home render
 * causes large frame stalls on slower phones, so wait for navigation,
 * images and initial interactions to settle first.
 */
export function schedulePushTokenSync(): void {
  if (currentToken || scheduledSync || scheduledInteraction) return;
  scheduledSync = setTimeout(() => {
    scheduledSync = null;
    scheduledInteraction = InteractionManager.runAfterInteractions(() => {
      scheduledInteraction = null;
      void syncPushToken();
    });
  }, 8000);
}

/** Called on logout so the account that just signed out stops getting pushes here. */
export async function clearPushToken(): Promise<void> {
  if (scheduledSync) clearTimeout(scheduledSync);
  scheduledSync = null;
  scheduledInteraction?.cancel();
  scheduledInteraction = null;
  try {
    if (currentToken) await unregisterPushToken(currentToken);
  } catch {
    /* best-effort */
  } finally {
    currentToken = null;
  }
}

/**
 * Maps a server `linkUrl` (storefront-relative path or absolute URL) to an
 * in-app route. Unknown / external links fall back to the notifications
 * screen so a tap always goes somewhere sensible.
 */
function routeForLink(linkUrl: unknown): string {
  if (typeof linkUrl !== "string" || linkUrl.length === 0) return "/(app)/notifications";
  if (/^https?:\/\//i.test(linkUrl)) return "/(app)/notifications";
  if (linkUrl.startsWith("/cart")) return "/(app)/(tabs)/cart";
  if (linkUrl.startsWith("/account/orders") || linkUrl.startsWith("/orders")) {
    return "/(app)/(tabs)/orders";
  }
  if (linkUrl.startsWith("/products") || linkUrl.startsWith("/shop") || linkUrl.startsWith("/category")) {
    return "/(app)/(tabs)/shop";
  }
  return "/(app)/notifications";
}

function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const data = response.notification.request.content.data as { linkUrl?: unknown };
  router.push(routeForLink(data?.linkUrl) as never);
}

/**
 * Registers the tap handler and processes a notification that cold-started
 * the app. Call once from the root navigator.
 */
export function useNotificationObserver(): void {
  useEffect(() => {
    let mounted = true;

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (mounted && response) handleNotificationResponse(response);
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
}
