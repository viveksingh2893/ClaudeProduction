import { useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { SafeImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export type GalleryImage = { id: string; url: string; altText?: string | null };

type Props = {
  images: GalleryImage[];
  height?: number;
};

/**
 * Shared image carousel + dot indicators for both customer and dealer
 * product-detail screens (web's ProductGallery equivalent). Falls back to
 * a single-image, no-dots view for the common case of one image, and
 * every slide goes through SafeImage so a broken/SVG source degrades to
 * the same placeholder used everywhere else in the app.
 */
export function ProductGallery({ images, height }: Props) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [galleryWidth, setGalleryWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const list = images.length > 0 ? images : [{ id: "placeholder", url: "", altText: null }];
  const resolvedHeight = height ?? (galleryWidth || windowWidth);

  useEffect(() => setActiveIndex(0), [images]);

  function onLayout(event: LayoutChangeEvent) {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== galleryWidth) setGalleryWidth(nextWidth);
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!galleryWidth) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / galleryWidth);
    if (index !== activeIndex) setActiveIndex(index);
  }

  return (
    <View style={styles.gallery} onLayout={onLayout}>
      {galleryWidth > 0 ? (
        <FlatList
          key={`gallery-${galleryWidth}`}
          data={list}
          horizontal
          pagingEnabled
          snapToInterval={galleryWidth}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          keyExtractor={(img) => img.id}
          onMomentumScrollEnd={onScrollEnd}
          getItemLayout={(_, index) => ({ length: galleryWidth, offset: galleryWidth * index, index })}
          renderItem={({ item }) => (
            <View style={{ width: galleryWidth, height: resolvedHeight }}>
              <SafeImage
                uri={item.url}
                style={styles.image}
                resizeMode="contain"
                accessibilityLabel={item.altText ?? undefined}
              />
            </View>
          )}
        />
      ) : (
        <View style={{ height: resolvedHeight }} />
      )}
      {list.length > 1 ? (
        <View style={styles.dots}>
          {list.map((img, i) => (
            <View
              key={img.id}
              style={[
                styles.dot,
                {
                  backgroundColor: i === activeIndex ? theme.green600 : theme.border,
                  width: i === activeIndex ? 18 : 6,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { width: "100%", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  dot: { height: 6, borderRadius: 3 },
});
