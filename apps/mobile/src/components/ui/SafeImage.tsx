import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image, type ImageContentFit } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/use-theme";
import { resolveImageUrl } from "@/lib/image-url";

/**
 * SVG can't be rasterized here — a URL ending in .svg would render as a
 * silent blank box. Treat those as unusable up front instead of waiting on
 * onError, since some hosts serve SVG with a 200 and no error.
 */
export function isUsableImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const path = url.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  return !path.endsWith(".svg");
}

type Props = {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain" | "stretch" | "center";
  accessibilityLabel?: string;
  iconSize?: number;
};

const FIT: Record<NonNullable<Props["resizeMode"]>, ImageContentFit> = {
  cover: "cover",
  contain: "contain",
  stretch: "fill",
  center: "scale-down",
};

const MAX_RETRIES = 3;

/**
 * Drop-in `<Image source={{ uri }} />` replacement backed by **expo-image**
 * (memory + disk cache), with a neutral placeholder when the URL is
 * missing / an SVG / genuinely broken.
 *
 * Why this exists instead of RN's <Image>: the storefront homepage / grids
 * fire dozens of image requests at once, and every product image is a
 * relative `/api/uploads/...` path served by the Next.js app through the
 * single Cloudflare tunnel to the Pi. Under that burst some requests time
 * out — and RN's <Image> `onError` is terminal, so one transient failure
 * left a permanent grey box. expo-image caches aggressively (a second view
 * of the same image never re-fetches) and here we also retry a failed load
 * a few times with backoff before giving up to the placeholder.
 */
export function SafeImage({
  uri,
  style,
  resizeMode = "cover",
  accessibilityLabel,
  iconSize = 28,
}: Props) {
  const theme = useTheme();
  const resolved = resolveImageUrl(uri);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const skeletonOpacity = useRef(new Animated.Value(0.45)).current;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New URL → reset the retry state.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setLoaded(false);
  }, [resolved]);

  useEffect(() => {
    if (loaded || failed) {
      skeletonOpacity.stopAnimation();
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonOpacity, {
          toValue: 0.9,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(skeletonOpacity, {
          toValue: 0.45,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [failed, loaded, skeletonOpacity]);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const usable = isUsableImageUrl(resolved) && !failed;

  if (!usable) {
    return (
      <View
        style={[
          style,
          {
            backgroundColor: theme.backgroundElement,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        <Ionicons name="image-outline" size={iconSize} color={theme.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[style as StyleProp<ViewStyle>, styles.frame]}>
      {!loaded ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.backgroundElement, opacity: skeletonOpacity },
          ]}
        />
      ) : null}
      <Image
        // Remounts on each retry so expo-image re-requests the (uncached) URL.
        key={attempt}
        source={{ uri: resolved }}
        style={StyleSheet.absoluteFill}
        contentFit={FIT[resizeMode]}
        cachePolicy="memory-disk"
        transition={120}
        recyclingKey={resolved}
        accessibilityLabel={accessibilityLabel}
        onLoadStart={() => setLoaded(false)}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          if (attempt < MAX_RETRIES) {
            const wait = 500 * (attempt + 1);
            retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), wait);
          } else {
            setFailed(true);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
});
