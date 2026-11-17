import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText, Badge, SafeImage } from "@/components/ui";
import { QuickAddModal } from "@/components/product-detail/QuickAddModal";
import { useTheme } from "@/hooks/use-theme";
import { tapFeedback } from "@/lib/haptics";
import { Radius, Spacing } from "@/constants/theme";
import type { DealerProductDTO, CustomerProductDTO } from "@/lib/api/types";

type Props = {
  product: CustomerProductDTO | DealerProductDTO;
  audience: "CUSTOMER" | "DEALER";
  isWishlisted?: boolean;
  onToggleWishlist?: (productId: string) => void;
  style?: StyleProp<ViewStyle>;
};

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Compact product tile — the mobile mirror of
 * apps/web/src/components/homepage/mini-product-card.tsx: a 1:1 image with
 * a wishlist heart, a two-line title, a "from ₹X" price line (lowest
 * active-variant price, with the MRP struck through) and a "Select size"
 * pill that opens the shared quick-add popup. No inline Add/Buy buttons,
 * no rating/badges clutter — this is the single card used by every
 * homepage / category / search / wishlist grid and rail.
 */
export function ProductCard({ product, audience, isWishlisted, onToggleWishlist, style }: Props) {
  const theme = useTheme();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const isDealer = audience === "DEALER";
  const unavailable = isDealer && !(product as DealerProductDTO).availableInState;
  const baseConfig = isDealer
    ? (product as DealerProductDTO).dealerConfig
    : (product as CustomerProductDTO).customerConfig;

  // Lowest active-variant price (matches web's "from ₹X"), falling back to
  // the product-level config for a non-variant product.
  const price = useMemo(() => {
    const active = (product.variants ?? []).filter((v) => v.isActive);
    const prices = active
      .map((v) => Number(v.sellingPrice))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length > 0) {
      const min = Math.min(...prices);
      const cheapest = active.find((v) => Number(v.sellingPrice) === min);
      return {
        selling: min,
        mrp: cheapest ? Number(cheapest.mrp) : null,
        multiple: new Set(prices).size > 1,
      };
    }
    if (baseConfig) {
      return { selling: Number(baseConfig.sellingPrice), mrp: Number(baseConfig.mrp), multiple: false };
    }
    return null;
  }, [product.variants, baseConfig]);

  function handlePress() {
    tapFeedback();
    if (isDealer) router.push({ pathname: "/(app)/dealer-product/[id]", params: { id: product.id } });
    else router.push({ pathname: "/(app)/product/[slug]", params: { slug: product.slug } });
  }

  const showStrike = price?.mrp != null && price.mrp > price.selling;

  return (
    <View style={[styles.wrap, style]}>
      <Pressable onPress={handlePress} style={styles.imageWrap}>
        <SafeImage
          uri={product.primaryImageUrl}
          style={styles.image}
          resizeMode="cover"
          accessibilityLabel={product.name}
        />
        {onToggleWishlist ? (
          <Pressable
            hitSlop={8}
            style={[styles.wishlistBtn, { backgroundColor: theme.surface }]}
            onPress={() => onToggleWishlist(product.id)}
          >
            <Ionicons
              name={isWishlisted ? "heart" : "heart-outline"}
              size={16}
              color={isWishlisted ? theme.danger : theme.textSecondary}
            />
          </Pressable>
        ) : null}
        {isDealer ? (
          <View style={styles.badgeOverlay}>
            <Badge label="Wholesale" tone="neutral" />
          </View>
        ) : null}
      </Pressable>

      <Pressable onPress={handlePress}>
        <AppText variant="body" numberOfLines={2} style={styles.name}>
          {product.name}
        </AppText>
      </Pressable>

      <View style={styles.priceRow}>
        <View style={styles.priceCol}>
          {unavailable ? (
            <Badge label="Not in your state" tone="warning" />
          ) : price ? (
            <View style={styles.priceLine}>
              <AppText variant="bodyBold" style={styles.price}>
                {price.multiple ? `from ${formatRupees(price.selling)}` : formatRupees(price.selling)}
              </AppText>
              {showStrike ? (
                <AppText variant="caption" color="secondary" style={styles.strike}>
                  {formatRupees(price.mrp!)}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>

        {!unavailable ? (
          <Pressable
            onPress={() => setQuickAddOpen(true)}
            style={[styles.selectPill, { borderColor: theme.green600 }]}
            accessibilityRole="button"
            accessibilityLabel="Select size"
          >
            <AppText variant="label" color="green" style={styles.selectPillText}>
              Select size
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {quickAddOpen ? (
        <QuickAddModal product={product} audience={audience} onClose={() => setQuickAddOpen(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  imageWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: 1,
    borderRadius: Radius.xl,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  wishlistBtn: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    borderRadius: Radius.pill,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeOverlay: { position: "absolute", left: Spacing.xs, bottom: Spacing.xs },
  name: { minHeight: 36, lineHeight: 18 },
  priceRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: Spacing.xs },
  priceCol: { flexShrink: 1 },
  priceLine: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 4 },
  price: { fontSize: 15 },
  strike: { textDecorationLine: "line-through" },
  selectPill: {
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectPillText: { fontSize: 11 },
});
