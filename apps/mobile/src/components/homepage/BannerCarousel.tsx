import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { router, type Href } from "expo-router";
import { SafeImage, Skeleton } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import type { HeroBannerDTO } from "@/lib/api/types";

// The website's home hero is `aspect-[2/1]` (banner-carousel.tsx) — match it.
const ASPECT_RATIO = 2;
// One centered banner per view on mobile (matches the storefront's mobile
// hero): the card is the full content width, so the next slide sits fully
// off-screen rather than peeking.
const SIDE_MARGIN = Spacing.lg;
const SPACING = Spacing.sm;
const AUTO_ROTATE_MS = 5000;
const RESUME_AFTER_INTERACTION_MS = 6000;

/**
 * mediaUrlSchema (packages/validators) only ever allows a relative path
 * ("/...") or an https:// URL for linkUrl — matches the same isExternal
 * check apps/web/src/components/homepage/banner-carousel.tsx uses. External
 * links open the device browser via Linking (always safe/valid). Internal
 * links push into this app's own route tree — which does not mirror the
 * website's URL structure 1:1, so a relative link only navigates correctly
 * here if it happens to match an existing mobile route.
 */
function openBannerLink(linkUrl: string | null) {
  if (!linkUrl) return;
  if (/^https?:\/\//i.test(linkUrl)) {
    Linking.openURL(linkUrl).catch(() => {});
    return;
  }
  router.push(linkUrl as Href);
}

export function BannerCarousel({
  banners,
  loading,
}: {
  banners: HeroBannerDTO[];
  loading?: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const theme = useTheme();
  const listRef = useRef<FlatList<HeroBannerDTO>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cardWidth = screenWidth - SIDE_MARGIN * 2;
  const sidePadding = SIDE_MARGIN;
  const snapInterval = cardWidth + SPACING;

  const clearAutoTimer = useCallback(() => {
    if (autoTimer.current) {
      clearInterval(autoTimer.current);
      autoTimer.current = null;
    }
  }, []);

  const startAutoTimer = useCallback(() => {
    clearAutoTimer();
    if (banners.length <= 1) return;
    autoTimer.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % banners.length;
        listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
        return next;
      });
    }, AUTO_ROTATE_MS);
  }, [banners.length, clearAutoTimer, snapInterval]);

  const pauseForInteraction = useCallback(() => {
    clearAutoTimer();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(startAutoTimer, RESUME_AFTER_INTERACTION_MS);
  }, [clearAutoTimer, startAutoTimer]);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / snapInterval);
      setActiveIndex(Math.max(0, Math.min(index, banners.length - 1)));
    },
    [banners.length, snapInterval],
  );

  useEffect(() => {
    startAutoTimer();
    return () => {
      clearAutoTimer();
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
    // Intentionally re-armed only when the banner count changes (a new
    // startAutoTimer identity from cardWidth/screenWidth changing on
    // rotation shouldn't restart the timer and reset the user's position).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banners.length]);

  if (loading) {
    return (
      <View style={[styles.wrap, { paddingHorizontal: sidePadding }]}>
        <Skeleton width={cardWidth} height={cardWidth / ASPECT_RATIO} radius={Radius.xl} />
      </View>
    );
  }

  // No active banners configured — an intentional empty state (no visible
  // placeholder box), matching how the rest of the homepage's optional
  // sections (ProductRow, BrandRow) behave when there's nothing to show.
  if (banners.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        horizontal
        data={banners}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        snapToInterval={snapInterval}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: sidePadding }}
        onScrollBeginDrag={pauseForInteraction}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item, index }) => (
          <BannerSlide
            banner={item}
            width={cardWidth}
            marginRight={index === banners.length - 1 ? 0 : SPACING}
          />
        )}
      />
      {banners.length > 1 && (
        <View style={styles.dots}>
          {banners.map((b, i) => (
            <View
              key={b.id}
              style={[
                styles.dot,
                {
                  backgroundColor: i === activeIndex ? theme.earth600 : theme.border,
                  width: i === activeIndex ? 18 : 6,
                },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function BannerSlide({
  banner,
  width,
  marginRight,
}: {
  banner: HeroBannerDTO;
  width: number;
  marginRight: number;
}) {
  const source = banner.mobileImageUrl || banner.desktopImageUrl;
  const height = width / ASPECT_RATIO;

  const content = (
    <SafeImage
      uri={source}
      style={[styles.slide, { width, height, marginRight }]}
      resizeMode="cover"
      accessibilityLabel={banner.altText}
      iconSize={28}
    />
  );

  if (!banner.linkUrl) return content;

  return (
    <Pressable
      onPress={() => openBannerLink(banner.linkUrl)}
      accessibilityRole="button"
      accessibilityLabel={banner.altText}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  slide: { borderRadius: Radius.xl, overflow: "hidden" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { height: 6, borderRadius: Radius.pill },
});
