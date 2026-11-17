import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { router, useIsFocused } from "expo-router";
import { AppText } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useSplashReady } from "@/context/splash-ready-context";
import { useTheme } from "@/hooks/use-theme";
import { getSiteSettings } from "@/lib/api/site-settings";
import { resolveImageUrl } from "@/lib/image-url";
import { Radius, Spacing } from "@/constants/theme";
import { siteUrl } from "@/lib/site-origin";

const TERMS_URL = siteUrl("/terms");
const PRIVACY_URL = siteUrl("/privacy");

/**
 * The first screen — a Hinge-style login page. A silent, looping video
 * plays full-bleed behind everything (SiteSettings.loginVideoUrl, set from
 * /admin/app-login-video; a branded gradient when none is configured),
 * under a dark scrim so the white content stays legible. The account /
 * OTP verify happens from here — "Continue as guest" starts a guest
 * browsing session instead.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const { continueAsGuest } = useAuth();
  const { markWelcomeReady } = useSplashReady();
  const isFocused = useIsFocused();
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoTimedOut, setVideoTimedOut] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [surfaceKey, setSurfaceKey] = useState(0);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const isFocusedRef = useRef(isFocused);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    let alive = true;
    getSiteSettings().then((res) => {
      if (alive) {
        if (res.ok) setVideoUri(resolveImageUrl(res.data.loginVideoUrl));
        setSettingsLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") setVideoReady(true);
      if (status === "error") {
        setVideoFailed(true);
        markWelcomeReady();
      }
    });
    return () => subscription.remove();
  }, [player, markWelcomeReady]);

  useEffect(() => {
    if (!videoUri) return;
    let cancelled = false;
    setVideoReady(false);
    setVideoFailed(false);
    (async () => {
      try {
        // Registering the status listener before replacing the source avoids
        // missing a fast readyToPlay event on locally cached videos.
        await player.replaceAsync({ uri: videoUri, useCaching: true });
        if (cancelled) return;
        if (isFocusedRef.current && AppState.currentState === "active") player.play();
        if (player.status === "readyToPlay") setVideoReady(true);
      } catch {
        if (!cancelled) {
          setVideoFailed(true);
          markWelcomeReady();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoUri, player, markWelcomeReady]);

  const resumePlayback = useCallback(async () => {
    if (!videoUri) return;
    try {
      if (player.status === "error" || player.status === "idle") {
        await player.replaceAsync({ uri: videoUri, useCaching: true });
        setVideoFailed(false);
      }
      player.play();
    } catch {
      setVideoFailed(true);
      markWelcomeReady();
    }
  }, [videoUri, player, markWelcomeReady]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returningToForeground =
        (appState.current === "background" || appState.current === "inactive") &&
        nextState === "active";
      appState.current = nextState;

      if (returningToForeground) {
        // A recreated Android Activity needs a new native surface even though
        // the JS player instance can survive in the existing process.
        setSurfaceKey((key) => key + 1);
        if (isFocused) void resumePlayback();
      } else if (nextState === "background" || nextState === "inactive") {
        player.pause();
      }
    });
    return () => subscription.remove();
  }, [isFocused, player, resumePlayback]);

  useEffect(() => {
    if (!videoUri) return;
    if (isFocused && AppState.currentState === "active") {
      void resumePlayback();
    } else {
      player.pause();
    }
  }, [isFocused, videoUri, player, resumePlayback]);

  useEffect(() => {
    if (settingsLoaded && (!videoUri || videoReady || videoFailed)) markWelcomeReady();
  }, [settingsLoaded, videoUri, videoReady, videoFailed, markWelcomeReady]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setVideoTimedOut(true);
      markWelcomeReady();
    }, 4500);
    return () => clearTimeout(timeout);
  }, [markWelcomeReady]);

  const showIntroLogo =
    (!settingsLoaded && !videoTimedOut) ||
    (!!videoUri && !videoReady && !videoFailed && !videoTimedOut);

  async function handleGuest() {
    setGuestLoading(true);
    const ok = await continueAsGuest();
    setGuestLoading(false);
    if (ok) router.replace("/(app)/(tabs)");
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.ink }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.green900 }]} />
      {videoUri && !videoFailed ? (
        <VideoView
          key={surfaceKey}
          style={[StyleSheet.absoluteFill, { opacity: videoReady ? 1 : 0 }]}
          player={player}
          contentFit="cover"
          nativeControls={false}
          surfaceType="textureView"
          pointerEvents="none"
        />
      ) : null}

      {/* full-screen dark scrim so the white content stays legible over
          any video frame — covers the entire frame, not just the lower half */}
      <View style={[StyleSheet.absoluteFill, styles.scrimFlat]} />
      <View style={[StyleSheet.absoluteFill, styles.scrimBottom]} pointerEvents="none" />

      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.brand}>
          <Image
            source={require("../../../assets/images/kisan4u-logo.png")}
            style={styles.logo}
            resizeMode="center"
          />
          <AppText color="white" variant="body" style={styles.tagline}>
            One marketplace for your farm and your business — customers and dealers.
          </AppText>
        </View>

        <View style={styles.bottom}>
          <AppText color="white" variant="caption" style={styles.legal}>
            By continuing you agree to our{" "}
            <AppText
              color="white"
              variant="label"
              style={styles.link}
              onPress={() => Linking.openURL(TERMS_URL)}
            >
              Terms of Service
            </AppText>{" "}
            and{" "}
            <AppText
              color="white"
              variant="label"
              style={styles.link}
              onPress={() => Linking.openURL(PRIVACY_URL)}
            >
              Privacy Policy
            </AppText>
            .
          </AppText>

          <Pressable
            style={[styles.primary, { backgroundColor: theme.green600 }]}
            onPress={() => router.push("/(auth)/customer-login")}
            accessibilityRole="button"
          >
            <AppText color="white" variant="bodyBold" style={styles.primaryText}>
              Log in / Sign up
            </AppText>
          </Pressable>

          <Pressable style={styles.guest} onPress={handleGuest} disabled={guestLoading}>
            {guestLoading ? (
              <ActivityIndicator color={theme.onGreen} />
            ) : (
              <AppText color="white" variant="bodyBold" style={styles.guestText}>
                Continue as guest
              </AppText>
            )}
          </Pressable>

          <View style={styles.altRow}>
            <Pressable onPress={() => router.push("/(auth)/dealer-register")}>
              <AppText color="white" variant="caption" style={styles.altLink}>
                I&apos;m a dealer
              </AppText>
            </Pressable>
            <AppText color="white" variant="caption" style={styles.altDot}>
              ·
            </AppText>
            <Pressable onPress={() => router.push("/(auth)/seller-login")}>
              <AppText color="white" variant="caption" style={styles.altLink}>
                Seller login
              </AppText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
      {showIntroLogo ? (
        <View style={[StyleSheet.absoluteFill, styles.introCover]}>
          <Image
            source={require("../../../assets/images/splash-logo.png")}
            style={styles.introLogo}
            resizeMode="contain"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrimFlat: { backgroundColor: "rgba(0,0,0,0.45)" },
  // Second full-frame layer — stacks with scrimFlat to ~0.62 over the
  // whole screen (was a 55%-height bottom band, which read as a
  // half-screen gradient). Kept as its own view so the depth is easy to
  // tune without touching scrimFlat.
  scrimBottom: { backgroundColor: "rgba(0,0,0,0.3)" },
  safe: { flex: 1, justifyContent: "space-between", padding: Spacing.xl },
  brand: { alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xxl * 1.4 },
  logo: { width: 172, height: 60 },
  introCover: { backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  introLogo: { width: 200, height: 200 },
  tagline: { textAlign: "center", maxWidth: 300, opacity: 0.92 },
  bottom: { gap: Spacing.md, paddingBottom: Spacing.sm },
  legal: { textAlign: "center", lineHeight: 18, opacity: 0.85, paddingHorizontal: Spacing.sm },
  link: { textDecorationLine: "underline", fontSize: 12 },
  primary: {
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  primaryText: { fontSize: 16 },
  guest: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: Spacing.xs,
  },
  guestText: { fontSize: 15 },
  altRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: Spacing.sm },
  altLink: { opacity: 0.85, textDecorationLine: "underline" },
  altDot: { opacity: 0.6 },
});
