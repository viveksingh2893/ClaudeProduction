import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText, Badge, Button, PriceTag, SafeImage } from "@/components/ui";
import { VariantPicker } from "./VariantPicker";
import { QuantityInput } from "./QuantityInput";
import { useTheme } from "@/hooks/use-theme";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { usePurchaseActions } from "@/lib/purchase-actions";
import { htmlToPlainText } from "@/lib/html-to-plain-text";
import { getProductBySlug } from "@/lib/api/catalog";
import { getDealerProduct } from "@/lib/api/dealer";
import { Radius, Spacing } from "@/constants/theme";
import type {
  CustomerProductDTO,
  DealerProductDTO,
  ProductVariantDTO,
} from "@/lib/api/types";

type BaseConfig = { mrp: string; sellingPrice: string; minOrderQty: number; currentStock: number };

type Detail = {
  name: string;
  images: { id: string; url: string; altText: string | null }[];
  sellerName: string | null;
  shortDescription: string | null;
  variants: ProductVariantDTO[];
  defaultVariantId: string | null;
  baseConfig: BaseConfig | null;
};

/**
 * The "Select size" quick-add popup — the mobile mirror of
 * apps/web/src/components/quick-add/quick-add-button.tsx: product image,
 * seller line, short description, the shared attribute-button
 * <VariantPicker>, price + MRP, a quantity stepper and Add to Cart / Buy
 * Now. Opens straight from a listing card so the shopper never has to open
 * the full product page just to drop one SKU in the cart.
 */
export function QuickAddModal({
  product,
  audience,
  onClose,
}: {
  product: CustomerProductDTO | DealerProductDTO;
  audience: "CUSTOMER" | "DEALER";
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { dbLang } = useLanguage();
  const toast = useToast();
  const { busy, addToCart, buyNow } = usePurchaseActions();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (audience === "DEALER") {
        const res = await getDealerProduct(product.id);
        if (!alive) return;
        if (!res.ok) return setLoadError(res.error.message);
        const p = res.data.product;
        setDetail({
          name: p.name,
          images:
            p.images.length > 0
              ? p.images
              : [{ id: "primary", url: p.primaryImageUrl, altText: p.name }],
          sellerName: p.seller?.shopName ?? null,
          shortDescription: p.shortDescription ?? null,
          variants: p.variants,
          defaultVariantId: p.variants.find((v) => v.isDefault)?.id ?? null,
          baseConfig: p.dealerConfig,
        });
      } else {
        const res = await getProductBySlug(product.slug, dbLang);
        if (!alive) return;
        if (!res.ok) return setLoadError(res.error.message);
        const p = res.data.product;
        setDetail({
          name: p.name,
          images:
            p.images.length > 0
              ? p.images
              : [{ id: "primary", url: p.primaryImageUrl, altText: p.name }],
          sellerName: p.seller?.shopName ?? null,
          shortDescription: p.shortDescription ?? null,
          variants: p.variants,
          defaultVariantId: p.variants.find((v) => v.isDefault)?.id ?? null,
          baseConfig: p.customerConfig,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [product, audience, dbLang]);

  async function handleAdd(variantId: string | undefined, quantity: number, buy: boolean) {
    const action = buy ? buyNow : addToCart;
    const result = await action({ productId: product.id, variantId, quantity });
    if (result.ok) {
      if (buy) {
        onClose();
      } else {
        toast.success("Added to cart");
        onClose();
      }
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: theme.surface, paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        <View style={styles.grabberRow}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        </View>
        <View style={styles.headerRow}>
          <AppText variant="subtitle" numberOfLines={2} style={styles.headerText}>
            {detail?.name ?? product.name}
          </AppText>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {loadError ? (
            <AppText variant="body" color="danger">
              {loadError}
            </AppText>
          ) : !detail ? (
            <AppText variant="body" color="secondary">
              Loading options…
            </AppText>
          ) : (
            <>
              <SafeImage
                uri={detail.images[0]?.url}
                style={[styles.image, { backgroundColor: theme.green50 }]}
                resizeMode="cover"
                accessibilityLabel={detail.name}
              />
              {detail.sellerName ? (
                <AppText variant="caption" color="secondary">
                  Sold by <AppText variant="label" color="green">{detail.sellerName}</AppText>
                </AppText>
              ) : null}
              {detail.shortDescription ? (
                <AppText variant="body" color="secondary" numberOfLines={3}>
                  {htmlToPlainText(detail.shortDescription)}
                </AppText>
              ) : null}

              {detail.variants.length > 0 ? (
                <VariantPicker
                  variants={detail.variants}
                  defaultVariantId={detail.defaultVariantId}
                  renderPurchaseArea={(v) => (
                    <PurchaseArea
                      variantId={v.id}
                      mrp={v.mrp}
                      sellingPrice={v.sellingPrice}
                      minOrderQty={v.minOrderQty}
                      stockQty={v.stockQty}
                      busy={busy}
                      onAdd={handleAdd}
                    />
                  )}
                />
              ) : detail.baseConfig ? (
                <PurchaseArea
                  variantId={undefined}
                  mrp={detail.baseConfig.mrp}
                  sellingPrice={detail.baseConfig.sellingPrice}
                  minOrderQty={detail.baseConfig.minOrderQty}
                  stockQty={detail.baseConfig.currentStock}
                  busy={busy}
                  onAdd={handleAdd}
                />
              ) : (
                <View style={{ gap: Spacing.sm }}>
                  <Badge label="Not available to add here" tone="warning" />
                  <Pressable
                    onPress={() => {
                      onClose();
                      if (audience === "DEALER") {
                        router.push({ pathname: "/(app)/dealer-product/[id]", params: { id: product.id } });
                      } else {
                        router.push({ pathname: "/(app)/product/[slug]", params: { slug: product.slug } });
                      }
                    }}
                  >
                    <AppText variant="bodyBold" color="green">
                      Open product page
                    </AppText>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function PurchaseArea({
  variantId,
  mrp,
  sellingPrice,
  minOrderQty,
  stockQty,
  busy,
  onAdd,
}: {
  variantId: string | undefined;
  mrp: string;
  sellingPrice: string;
  minOrderQty: number;
  stockQty: number;
  busy: "cart" | "buyNow" | null;
  onAdd: (variantId: string | undefined, quantity: number, buy: boolean) => void;
}) {
  const minQty = Math.max(1, minOrderQty);
  const [quantity, setQuantity] = useState(minQty);
  useEffect(() => setQuantity(minQty), [minQty]);

  const outOfStock = stockQty <= 0;

  return (
    <View style={styles.purchase}>
      <PriceTag mrp={mrp} sellingPrice={sellingPrice} size="lg" />
      {outOfStock ? (
        <Badge label="Out of stock" tone="danger" />
      ) : (
        <View style={styles.ctaRow}>
          <View style={styles.quantityContainer}>
            <QuantityInput
              quantity={quantity}
              minQuantity={minQty}
              maxQuantity={stockQty}
              onChange={setQuantity}
              showLabel={false}
              compact
            />
          </View>

          <View style={[styles.ctaHalf, styles.addToCartCta]}>
            <Button
              label="Add to Cart"
              variant="secondary"
              size="sm"
              onPress={() => onAdd(variantId, quantity, false)}
              loading={busy === "cart"}
              fullWidth
            />
          </View>

          <View style={styles.ctaHalf}>
            <Button
              label="Buy Now"
              variant="primary"
              size="sm"
              onPress={() => onAdd(variantId, quantity, true)}
              loading={busy === "buyNow"}
              fullWidth
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: Spacing.xl,
  },
  grabberRow: { alignItems: "center", paddingTop: Spacing.sm },
  grabber: { width: 40, height: 4, borderRadius: Radius.pill },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  headerText: { flex: 1 },
  body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md },
  image: { width: "100%", height: 200, borderRadius: Radius.lg },
  purchase: { gap: Spacing.sm },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  quantityContainer: { flexShrink: 0 },
  ctaHalf: { flex: 1, minWidth: 0 },
  addToCartCta: { flexGrow: 1.2 },
});
