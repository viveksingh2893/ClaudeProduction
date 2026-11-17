import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

export function Skeleton({
  width,
  height,
  radius = Radius.sm,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
}) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: theme.backgroundElement,
        opacity,
      }}
    />
  );
}

/** A generic product-card-shaped skeleton row, used while catalog/homepage data loads. */
export function ProductCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton width="100%" height={120} radius={Radius.md} />
      <Skeleton width="80%" height={14} />
      <Skeleton width="50%" height={14} />
      <Skeleton width="40%" height={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 150, gap: Spacing.xxs },
});
