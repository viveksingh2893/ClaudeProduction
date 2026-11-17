import { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Badge, Button, ErrorState, PriceTag } from "@/components/ui";
import { Accordion } from "@/components/ui/Accordion";
import { InfiniteProductGrid, type ProductPage } from "@/components/InfiniteProductGrid";
import { ProductGallery } from "@/components/product-detail/ProductGallery";
import { VariantPicker } from "@/components/product-detail/VariantPicker";
import { QuantityInput, clampQuantity } from "@/components/product-detail/QuantityInput";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/context/toast-context";
import { htmlToPlainText } from "@/lib/html-to-plain-text";
import { getDealerProduct, getDealerProducts } from "@/lib/api/dealer";
import { toggleWishlist } from "@/lib/api/wishlist";
import { usePurchaseActions } from "@/lib/purchase-actions";
import { Spacing } from "@/constants/theme";
import type { DealerProductDTO, LineEligibility, ProductVariantDTO } from "@/lib/api/types";
import { siteUrl } from "@/lib/site-origin";

/**
 * Dealer product page — the same layout and the SAME shared
 * attribute-button <VariantPicker> as the customer PDP (previously this
 * screen rendered one card-with-buttons per variant, nothing like the
 * web). Order: gallery → name → seller → short description → variant
 * selection → the resolved variant's wholesale price / eligibility →
 * "Product details" collapsible cards → "More products" dealer feed.
 * Purchase actions and the sticky bar are eligibility-aware: a variant not
 * available in the dealer's state offers "Request Seller" instead of Add to
 * Cart (mirrors apps/web/src/components/dealer-purchase-panel.tsx).
 */
export default function DealerProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { busy, addToCart, buyNow } = usePurchaseActions();

  const [product, setProduct] = useState<DealerProductDTO | null>(null);
  const [baseEligibility, setBaseEligibility] = useState<LineEligibility | null>(null);
  const [variantEligibilities, setVariantEligibilities] = useState<LineEligibility[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resolvedVariant, setResolvedVariant] = useState<ProductVariantDTO | null>(null);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const load = useCallback(async () => {
    const result = await getDealerProduct(id);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setProduct(result.data.product);
    setBaseEligibility(result.data.baseEligibility);
    setVariantEligibilities(result.data.variantEligibilities);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingMinQty = product
    ? product.variants.length > 0
      ? (resolvedVariant?.minOrderQty ?? 1)
      : (product.dealerConfig?.minOrderQty ?? 1)
    : 1;
  const pendingMaxQty = product
    ? product.variants.length > 0
      ? (resolvedVariant?.stockQty ?? pendingMinQty)
      : (product.dealerConfig?.currentStock ?? pendingMinQty)
    : 1;

  useEffect(() => {
    setQuantity(clampQuantity(pendingMinQty, pendingMinQty, pendingMaxQty));
  }, [product?.id, resolvedVariant?.id, pendingMinQty, pendingMaxQty]);

  const categorySlug = product?.category.slug;
  const moreFetch = useCallback(
    async (page: number): Promise<ProductPage | null> => {
      if (!categorySlug) return null;
      const res = await getDealerProducts({ category: categorySlug, page });
      if (!res.ok) return null;
      return { items: res.data.items, hasMore: res.data.hasMore };
    },
    [categorySlug],
  );

  async function handleToggleWishlist() {
    if (!product) return;
    const result = await toggleWishlist(product.id);
    if (result.ok) setIsWishlisted(result.data.wishlisted);
  }

  async function handleShare() {
    const url = siteUrl(`/dealer/products/${encodeURIComponent(id)}`);
    try {
      await Share.share({
        title: product?.name ?? "Kisan4U dealer product",
        message: `${product?.name ?? "View this dealer product on Kisan4U"}: ${url}`,
        url,
      });
    } catch {
      // The user dismissed the native share sheet.
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!product) return null;

  const hasVariants = product.variants.length > 0;
  const defaultVariantId = product.variants.find((v) => v.isDefault)?.id ?? null;
  const images =
    product.images.length > 0
      ? product.images
      : [{ id: "primary", url: product.primaryImageUrl, altText: product.name }];

  function eligibilityFor(variant: ProductVariantDTO | null): LineEligibility | null {
    if (!variant) return hasVariants ? null : baseEligibility;
    const idx = product!.variants.findIndex((v) => v.id === variant.id);
    return idx >= 0 ? (variantEligibilities[idx] ?? null) : null;
  }

  const activeEligibility = hasVariants ? eligibilityFor(resolvedVariant) : baseEligibility;
  const stateBlocked =
    !!activeEligibility && !activeEligibility.ok && activeEligibility.code === "STATE_UNAVAILABLE";
  const canBuy = !!activeEligibility && activeEligibility.ok;
  const minQty = pendingMinQty;
  const maxQty = pendingMaxQty;

  // What the sticky action row shows — the resolved variant's (or the
  // base config's) wholesale price, mirrored from the customer PDP's bar.
  const barPrice = hasVariants
    ? resolvedVariant
      ? { selling: resolvedVariant.sellingPrice, mrp: resolvedVariant.mrp }
      : null
    : product.dealerConfig
      ? { selling: product.dealerConfig.sellingPrice, mrp: product.dealerConfig.mrp }
      : null;
  const savedAmount =
    barPrice && Number(barPrice.mrp) > Number(barPrice.selling)
      ? Number(barPrice.mrp) - Number(barPrice.selling)
      : 0;

  function requestSeller() {
    router.push({
      pathname: "/(app)/dealer-requests/new",
      params: { productId: product!.id, variantId: resolvedVariant?.id ?? "" },
    });
  }

  async function handleAdd(buy: boolean) {
    if (!product) return;
    const action = buy ? buyNow : addToCart;
    const result = await action({
      productId: product.id,
      variantId: resolvedVariant?.id,
      quantity,
    });
    if (result.ok) {
      if (!buy) toast.success("Added to cart");
    } else {
      toast.error(result.error.message);
    }
  }

  const detailItems = [
    { key: "description", title: "Description", value: product.description },
    { key: "ingredients", title: "Ingredients", value: product.ingredients },
    { key: "howToUse", title: "How to Use", value: product.howToUse },
    { key: "dosage", title: "Dosage", value: product.dosageInstructions },
  ]
    .filter((d): d is { key: string; title: string; value: string } => !!d.value)
    .map((d) => ({
      key: d.key,
      title: d.title,
      content: (
        <AppText variant="body" color="secondary">
          {htmlToPlainText(d.value)}
        </AppText>
      ),
    }));

  function renderPurchaseArea(
    eligibility: LineEligibility | null,
    mrp: string,
    sellingPrice: string,
  ) {
    if (!eligibility) {
      return (
        <AppText variant="caption" color="secondary">
          Not configured for dealer purchase yet.
        </AppText>
      );
    }
    if (eligibility.ok) {
      return <PriceTag mrp={mrp} sellingPrice={sellingPrice} size="lg" />;
    }
    if (eligibility.code === "STATE_UNAVAILABLE") {
      return <Badge label="Not available in your state" tone="warning" />;
    }
    return (
      <AppText variant="caption" color="danger">
        {eligibility.error}
      </AppText>
    );
  }

  const header = (
    <View>
      <ProductGallery images={images} />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color="secondary">
              {product.brand?.name ?? "—"}
              {product.manufacturer ? ` · ${product.manufacturer.name}` : ""}
            </AppText>
            <AppText variant="title">{product.name}</AppText>
            {product.subtitle ? (
              <AppText variant="body" color="secondary">
                {product.subtitle}
              </AppText>
            ) : null}
          </View>
          <View style={styles.titleActions}>
            <Pressable onPress={handleShare} hitSlop={10} accessibilityLabel="Share product">
              <Ionicons name="share-social-outline" size={25} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={handleToggleWishlist}
              hitSlop={10}
              accessibilityLabel="Wishlist product"
            >
              <Ionicons
                name={isWishlisted ? "heart" : "heart-outline"}
                size={26}
                color={isWishlisted ? theme.danger : theme.textSecondary}
              />
            </Pressable>
          </View>
        </View>

        {product.seller?.shopName ? (
          <AppText variant="caption" color="secondary">
            Sold by{" "}
            <AppText variant="label" color="green">
              {product.seller.shopName}
            </AppText>
          </AppText>
        ) : null}

        <Badge label="Wholesale price" tone="earth" />

        {product.shortDescription ? (
          <AppText variant="body" color="secondary">
            {htmlToPlainText(product.shortDescription)}
          </AppText>
        ) : null}

        {hasVariants ? (
          <VariantPicker
            variants={product.variants}
            defaultVariantId={defaultVariantId}
            onResolvedChange={setResolvedVariant}
            renderPurchaseArea={(v) => (
              <View style={styles.priceArea}>
                {renderPurchaseArea(eligibilityFor(v), v.mrp, v.sellingPrice)}
              </View>
            )}
          />
        ) : (
          <View style={styles.priceArea}>
            {renderPurchaseArea(
              baseEligibility,
              product.dealerConfig?.mrp ?? "0",
              product.dealerConfig?.sellingPrice ?? "0",
            )}
          </View>
        )}

        {detailItems.length > 0 ? (
          <View style={[styles.section, { borderTopColor: theme.border }]}>
            <AppText variant="subtitle">Product details</AppText>
            <Accordion items={detailItems} defaultOpenKeys={["description"]} />
          </View>
        ) : null}

        <View style={[styles.section, { borderTopColor: theme.border }]}>
          <AppText variant="subtitle">More products</AppText>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <InfiniteProductGrid
        key={product.id}
        fetchPage={moreFetch}
        audience="DEALER"
        excludeIds={[product.id]}
        ListHeaderComponent={header}
        emptyTitle="No more products in this category"
      />

      <View
        style={[
          styles.stickyBar,
          {
            backgroundColor: theme.surface,
            borderTopColor: theme.border,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        {stateBlocked ? (
          <Button label="Request Seller" variant="primary" onPress={requestSeller} fullWidth />
        ) : (
          <>
            {canBuy && barPrice ? (
              <View style={styles.barTopRow}>
                <View style={styles.barPrice}>
                  <AppText variant="subtitle">
                    {`₹${Number(barPrice.selling).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                  </AppText>
                  {Number(barPrice.mrp) > Number(barPrice.selling) ? (
                    <AppText variant="caption" color="secondary" style={styles.barStrike}>
                      {`₹${Number(barPrice.mrp).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                    </AppText>
                  ) : null}
                </View>
                {savedAmount > 0 ? (
                  <Badge
                    label={`Saved ₹${savedAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                    tone="success"
                  />
                ) : null}
              </View>
            ) : null}
            <View style={styles.actionRow}>
              <View style={styles.quantityContainer}>
                <QuantityInput
                  quantity={quantity}
                  minQuantity={minQty}
                  maxQuantity={maxQty}
                  onChange={setQuantity}
                  showLabel={false}
                  disabled={!canBuy}
                  compact
                />
              </View>

              <View style={[styles.ctaHalf, styles.addToCartCta]}>
                <Button
                  label="Add to Cart"
                  variant="secondary"
                  size="sm"
                  onPress={() => handleAdd(false)}
                  loading={busy === "cart"}
                  disabled={!canBuy}
                  fullWidth
                />
              </View>

              <View style={styles.ctaHalf}>
                <Button
                  label="Buy Now"
                  variant="primary"
                  size="sm"
                  onPress={() => handleAdd(true)}
                  loading={busy === "buyNow"}
                  disabled={!canBuy}
                  fullWidth
                />
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  titleRow: { flexDirection: "row", gap: Spacing.sm },
  titleActions: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  priceArea: { gap: Spacing.sm },
  section: { gap: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  stickyBar: {
    alignItems: "stretch",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  barTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  barPrice: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  barStrike: { textDecorationLine: "line-through" },
  quantityContainer: {
    flexShrink: 0,
  },
  ctaHalf: {
    flex: 1,
    minWidth: 0,
  },
  addToCartCta: { flexGrow: 1.2 },
});
