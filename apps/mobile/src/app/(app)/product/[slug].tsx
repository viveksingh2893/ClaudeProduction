import { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  AppText,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PriceTag,
  TextField,
} from "@/components/ui";
import { Accordion } from "@/components/ui/Accordion";
import { ProductRow } from "@/components/ProductRow";
import { InfiniteProductGrid, type ProductPage } from "@/components/InfiniteProductGrid";
import { useToast } from "@/context/toast-context";
import { useLanguage, useT } from "@/context/language-context";
import { ProductGallery } from "@/components/product-detail/ProductGallery";
import { VariantPicker } from "@/components/product-detail/VariantPicker";
import { QuantityInput, clampQuantity } from "@/components/product-detail/QuantityInput";
import { useTheme } from "@/hooks/use-theme";
import { htmlToPlainText } from "@/lib/html-to-plain-text";
import { getProductBySlug, getProducts } from "@/lib/api/catalog";
import { usePurchaseActions } from "@/lib/purchase-actions";
import { toggleWishlist } from "@/lib/api/wishlist";
import { submitReview } from "@/lib/api/reviews";
import { Spacing } from "@/constants/theme";
import type { CustomerProductDTO, ProductVariantDTO, ReviewRow } from "@/lib/api/types";
import { siteUrl } from "@/lib/site-origin";

/**
 * Customer product page — the mobile mirror of
 * apps/web/src/app/products/[slug]/page.tsx, in the owner-specified order:
 *
 *   image gallery → name → seller → short description →
 *   attribute-button variant selection → selected variant's price + MRP →
 *   "Similar Products" one-line horizontal rail → "Product details"
 *   collapsible cards (Description / Ingredients / How to Use / Dosage) →
 *   ratings & reviews → "More products" 2-per-row infinite feed.
 *
 * The whole page is ONE list (InfiniteProductGrid with everything above as
 * its header) so there's no nested-scroll. Add to Cart / Buy Now live in
 * the fixed sticky bar, bound to the resolved variant; quantity is chosen
 * in the cart, matching web.
 */
export default function ProductDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const t = useT();
  const { dbLang } = useLanguage();
  const { busy, addToCart, buyNow } = usePurchaseActions();

  const [product, setProduct] = useState<CustomerProductDTO | null>(null);
  const [similar, setSimilar] = useState<CustomerProductDTO[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableForDealer, setUnavailableForDealer] = useState(false);
  const [resolvedVariant, setResolvedVariant] = useState<ProductVariantDTO | null>(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const load = useCallback(async () => {
    const result = await getProductBySlug(slug, dbLang);
    if (!result.ok) {
      if (result.error.code === "WRONG_CATALOGUE") {
        const redirect = result.error.details?.redirect;
        if (
          redirect &&
          typeof redirect === "object" &&
          "type" in redirect &&
          redirect.type === "dealer-product" &&
          "id" in redirect &&
          typeof redirect.id === "string"
        ) {
          router.replace({
            pathname: "/(app)/dealer-product/[id]",
            params: { id: redirect.id },
          });
          return;
        }
        if (
          redirect &&
          typeof redirect === "object" &&
          "type" in redirect &&
          redirect.type === "unavailable"
        ) {
          setError(null);
          setUnavailableForDealer(true);
          return;
        }
      }
      setError(result.error.message);
      return;
    }
    setError(null);
    setUnavailableForDealer(false);
    setProduct(result.data.product);
    setSimilar(result.data.similar);
    setReviews(result.data.reviews.rows);
    setCanReview(result.data.reviews.canReview);
    setIsWishlisted(result.data.isWishlisted);
  }, [slug, dbLang]);

  useEffect(() => {
    load();
  }, [load]);

  const categorySlug = product?.category.slug;
  const moreFetch = useCallback(
    async (page: number): Promise<ProductPage | null> => {
      if (!categorySlug) return null;
      const res = await getProducts({ category: categorySlug, page, lang: dbLang });
      if (!res.ok) return null;
      return { items: res.data.items, hasMore: res.data.hasMore };
    },
    [categorySlug, dbLang],
  );

  const minimumQuantity =
    product && product.variants.length > 0
      ? (resolvedVariant?.minOrderQty ?? 1)
      : (product?.customerConfig?.minOrderQty ?? 1);

  function currentMinQty(): number {
    return minimumQuantity;
  }

  const currentMaxQty = product
    ? product.variants.length > 0
      ? (resolvedVariant?.stockQty ?? 1)
      : (product.customerConfig?.currentStock ?? 1)
    : 1;

  useEffect(() => {
    const min = minimumQuantity;
    setQuantity(clampQuantity(min, min, currentMaxQty));
  }, [product?.id, resolvedVariant?.id, currentMaxQty, minimumQuantity]);

  async function handleAddToCart() {
    if (!product) return;
    const result = await addToCart({
      productId: product.id,
      variantId: resolvedVariant?.id,
      quantity,
    });
    if (result.ok) toast.success(t("pdp.addedToCart"));
    else toast.error(result.error.message);
  }

  async function handleBuyNow() {
    if (!product) return;
    const result = await buyNow({
      productId: product.id,
      variantId: resolvedVariant?.id,
      quantity,
    });
    if (!result.ok) toast.error(result.error.message);
  }

  async function handleToggleWishlist() {
    if (!product) return;
    const result = await toggleWishlist(product.id);
    if (result.ok) setIsWishlisted(result.data.wishlisted);
  }

  async function handleShare() {
    const url = siteUrl(`/products/${encodeURIComponent(slug)}`);
    try {
      await Share.share({
        title: product?.name ?? "Kisan4U product",
        message: `${product?.name ?? "View this product on Kisan4U"}: ${url}`,
        url,
      });
    } catch {
      // The user dismissed the native share sheet.
    }
  }

  async function handleSubmitReview() {
    if (reviewRating < 1) return;
    setSubmittingReview(true);
    const result = await submitReview(slug, {
      rating: reviewRating,
      comment: reviewComment || undefined,
    });
    setSubmittingReview(false);
    if (result.ok) {
      setReviewComment("");
      setReviewRating(0);
      load();
    }
  }

  if (unavailableForDealer) {
    return (
      <EmptyState
        title="Product unavailable"
        description="This product isn't available for dealers."
        actionLabel="Go to Home"
        onAction={() => router.replace("/(app)/(tabs)")}
      />
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!product) return null;

  const images =
    product.images.length > 0
      ? product.images
      : [{ id: "primary", url: product.primaryImageUrl, altText: product.name }];
  const hasVariants = product.variants.length > 0;
  const defaultVariantId = product.variants.find((v) => v.isDefault)?.id ?? null;

  // What the fixed bottom bar shows.
  const barPrice = hasVariants
    ? resolvedVariant
      ? { selling: resolvedVariant.sellingPrice, mrp: resolvedVariant.mrp }
      : null
    : product.customerConfig
      ? { selling: product.customerConfig.sellingPrice, mrp: product.customerConfig.mrp }
      : null;
  const barStock = hasVariants
    ? (resolvedVariant?.stockQty ?? 0)
    : (product.customerConfig?.currentStock ?? 0);
  const barStatus: "incomplete" | "out-of-stock" | "ready" =
    hasVariants && !resolvedVariant ? "incomplete" : barStock <= 0 ? "out-of-stock" : "ready";
  const savedAmount =
    barPrice && Number(barPrice.mrp) > Number(barPrice.selling)
      ? Number(barPrice.mrp) - Number(barPrice.selling)
      : 0;
  const purchaseDisabled = barStatus !== "ready";
  const showBar = hasVariants || product.customerConfig != null;

  const ratingAvg = product.ratingAverage != null ? Number(product.ratingAverage) : null;

  // "Product details" accordion — Description (open by default), then
  // Ingredients / How to Use / Dosage where the product has them.
  const detailItems = [
    { key: "description", title: t("pdp.description"), value: product.description },
    { key: "ingredients", title: t("pdp.ingredients"), value: product.ingredients },
    { key: "howToUse", title: t("pdp.howToUse"), value: product.howToUse },
    { key: "dosage", title: t("pdp.dosage"), value: product.dosageInstructions },
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

  const header = (
    <View>
      <ProductGallery images={images} />

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            {product.brand ? (
              <AppText variant="caption" color="secondary">
                {product.brand.name}
              </AppText>
            ) : null}
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
            {t("pdp.soldBy")}{" "}
            <AppText variant="label" color="green">
              {product.seller.shopName}
            </AppText>
          </AppText>
        ) : null}

        {ratingAvg ? (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color={theme.gold} />
            <AppText variant="body">
              {ratingAvg.toFixed(1)} ({product.ratingCount} {t("pdp.reviewsWord")})
            </AppText>
          </View>
        ) : null}

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
                <PriceTag mrp={v.mrp} sellingPrice={v.sellingPrice} size="lg" />
                {v.stockQty <= 0 ? <Badge label={t("pdp.outOfStock")} tone="danger" /> : null}
              </View>
            )}
          />
        ) : product.customerConfig ? (
          <View style={styles.priceArea}>
            <PriceTag
              mrp={product.customerConfig.mrp}
              sellingPrice={product.customerConfig.sellingPrice}
              size="lg"
            />
            {product.customerConfig.currentStock <= 0 ? (
              <Badge label={t("pdp.outOfStock")} tone="danger" />
            ) : null}
          </View>
        ) : null}

        {product.deliveryBadgeEnabled && product.deliveryBadgeText ? (
          <Badge label={product.deliveryBadgeText} tone="info" />
        ) : null}
      </View>

      <ProductRow
        title={t("pdp.similarProducts")}
        products={similar}
        audience="CUSTOMER"
        layout="scroll"
      />

      <View style={styles.content}>
        {detailItems.length > 0 ? (
          <View style={[styles.section, { borderTopColor: theme.border }]}>
            <AppText variant="subtitle">{t("pdp.productDetails")}</AppText>
            <Accordion items={detailItems} defaultOpenKeys={["description"]} />
          </View>
        ) : null}

        <View style={[styles.section, { borderTopColor: theme.border }]}>
          <AppText variant="subtitle">
            {t("pdp.reviews")} ({reviews.length})
          </AppText>
          {canReview ? (
            <View style={styles.reviewForm}>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setReviewRating(n)} hitSlop={6}>
                    <Ionicons
                      name={n <= reviewRating ? "star" : "star-outline"}
                      size={26}
                      color={theme.gold}
                    />
                  </Pressable>
                ))}
              </View>
              <TextField
                placeholder={t("pdp.reviewPlaceholder")}
                value={reviewComment}
                onChangeText={setReviewComment}
                multiline
              />
              <Button
                label={t("pdp.submitReview")}
                onPress={handleSubmitReview}
                loading={submittingReview}
                disabled={reviewRating < 1}
              />
            </View>
          ) : null}
          {reviews.map((r) => (
            <View key={r.id} style={[styles.reviewRow, { borderColor: theme.border }]}>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Ionicons
                    key={n}
                    name={n <= r.rating ? "star" : "star-outline"}
                    size={14}
                    color={theme.gold}
                  />
                ))}
                {r.verifiedPurchase ? <Badge label={t("pdp.verified")} tone="success" /> : null}
              </View>
              <AppText variant="bodyBold">
                {r.customerName ?? r.manualCustomerName ?? "Kisan4U customer"}
              </AppText>
              {r.comment ? (
                <AppText variant="body" color="secondary">
                  {r.comment}
                </AppText>
              ) : null}
            </View>
          ))}
        </View>

        <View style={[styles.section, { borderTopColor: theme.border }]}>
          <AppText variant="subtitle">{t("pdp.moreProducts")}</AppText>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <InfiniteProductGrid
        key={product.id}
        fetchPage={moreFetch}
        audience="CUSTOMER"
        excludeIds={[product.id, ...similar.map((s) => s.id)]}
        ListHeaderComponent={header}
        emptyTitle={t("pdp.noMoreProducts")}
      />

      {showBar ? (
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
          <View style={styles.barTopRow}>
            {barPrice ? (
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
            ) : (
              <AppText variant="caption" color="secondary" style={styles.barHint}>
                {t("pdp.selectOptions")}
              </AppText>
            )}
            {barStatus === "ready" && savedAmount > 0 ? (
              <Badge
                label={t("pdp.saved", {
                  amount: `₹${savedAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
                })}
                tone="success"
              />
            ) : null}
          </View>
          <View style={styles.barButtons}>
            <QuantityInput
              quantity={quantity}
              minQuantity={currentMinQty()}
              maxQuantity={barStock}
              onChange={setQuantity}
              showLabel={false}
              disabled={purchaseDisabled}
              compact
            />
            <View style={[styles.ctaHalf, styles.addToCartCta]}>
              <Button
                label={t("pdp.addToCart")}
                variant="secondary"
                size="sm"
                onPress={handleAddToCart}
                loading={busy === "cart"}
                disabled={purchaseDisabled}
                fullWidth
              />
            </View>
            <View style={styles.ctaHalf}>
              <Button
                label={t("pdp.buyNow")}
                variant="primary"
                size="sm"
                onPress={handleBuyNow}
                loading={busy === "buyNow"}
                disabled={purchaseDisabled}
                fullWidth
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  titleRow: { flexDirection: "row", gap: Spacing.sm },
  titleActions: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceArea: { gap: Spacing.sm },
  section: { gap: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  reviewForm: { gap: Spacing.sm },
  starRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  reviewRow: { gap: 4, paddingVertical: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  stickyBar: {
    alignItems: "stretch",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barPrice: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  barTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  barStrike: { textDecorationLine: "line-through" },
  barHint: { flex: 1 },
  barButtons: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  ctaHalf: { flex: 1, minWidth: 0 },
  addToCartCta: { flexGrow: 1.2 },
});
