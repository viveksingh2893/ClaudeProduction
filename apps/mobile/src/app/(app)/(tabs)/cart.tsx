import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, EmptyState, ErrorState, SafeImage, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useCart } from "@/context/cart-context";
import { getCart, removeCartItem, updateCartItemQuantity } from "@/lib/api/cart";
import { Radius, Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import type { CartDTO, CartLineDTO } from "@/lib/api/types";
import { QuantityInput } from "@/components/product-detail/QuantityInput";
import { useToast } from "@/context/toast-context";

function formatRupees(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function CartScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { refresh: refreshCartCount } = useCart();
  const toast = useToast();
  const [cart, setCart] = useState<CartDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getCart();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setCart(result.data);
    void refreshCartCount();
  }, [refreshCartCount]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleQuantityChange(item: CartLineDTO, next: number) {
    if (!cart || next === item.quantity) return;
    const previous = cart;
    const price = item.currentPrice ?? item.priceAtAdd;
    const difference = (next - item.quantity) * price;
    const sellerGroups = cart.sellerGroups.map((group) =>
      group.items.some((line) => line.cartItemId === item.cartItemId)
        ? {
            ...group,
            subtotal: group.subtotal + difference,
            items: group.items.map((line) =>
              line.cartItemId === item.cartItemId
                ? {
                    ...line,
                    quantity: next,
                    lineSubtotal: price * next,
                    validationError:
                      next >= Math.max(1, line.minOrderQty ?? 1) &&
                      (line.currentStock == null || next <= line.currentStock)
                        ? null
                        : line.validationError,
                  }
                : line,
            ),
          }
        : group,
    );
    setCart({
      ...cart,
      overallTotal: cart.overallTotal + difference,
      sellerGroups,
      hasValidationErrors: sellerGroups.some(
        (group) => !group.logisticsEstimate.ok || group.items.some((line) => !!line.validationError),
      ),
    });
    setBusyItemId(item.cartItemId);
    const result = await updateCartItemQuantity(item.cartItemId, next);
    if (!result.ok) {
      setCart(previous);
      toast.error(result.error.message);
    }
    setBusyItemId(null);
  }

  async function handleRemove(item: CartLineDTO) {
    setBusyItemId(item.cartItemId);
    await removeCartItem(item.cartItemId);
    await load();
    setBusyItemId(null);
  }

  if (error) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }

  if (!cart) return <Screen />;

  const allLines = cart.sellerGroups.flatMap((g) => g.items);
  if (allLines.length === 0) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <EmptyState
          title="Your cart is empty"
          description="Browse the shop to add products."
          actionLabel="Start shopping"
          onAction={() => router.push("/(app)/(tabs)/shop")}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <FlatList
        data={cart.sellerGroups}
        keyExtractor={(g) => g.sellerId}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + TAB_BAR_SCENE_INSET },
        ]}
        renderItem={({ item: group }) => (
          <View
            style={[
              styles.groupCard,
              { borderColor: theme.border, backgroundColor: theme.surface },
            ]}
          >
            <AppText variant="label" color="secondary">
              SOLD BY {group.sellerName.toUpperCase()}
            </AppText>
            {group.items.map((line) => (
              <View key={line.cartItemId} style={styles.lineRow}>
                <SafeImage
                  uri={line.productImageUrl}
                  style={styles.thumb}
                  accessibilityLabel={line.productName}
                />
                <View style={styles.lineBody}>
                  <AppText variant="bodyBold" numberOfLines={2}>
                    {line.productName}
                  </AppText>
                  {line.variantLabel ? (
                    <AppText variant="caption" color="secondary">
                      {line.variantLabel}
                    </AppText>
                  ) : null}
                  {line.validationError ? (
                    <AppText variant="caption" color="danger">
                      {line.validationError}
                    </AppText>
                  ) : (
                    <AppText variant="bodyBold">{formatRupees(line.lineSubtotal ?? 0)}</AppText>
                  )}
                  <View style={styles.qtyRow}>
                    <QuantityInput
                      quantity={line.quantity}
                      minQuantity={Math.max(1, line.minOrderQty ?? 1)}
                      maxQuantity={line.currentStock ?? undefined}
                      onChange={(next) => handleQuantityChange(line, next)}
                      showLabel={false}
                      disabled={busyItemId === line.cartItemId}
                    />
                    <Pressable
                      hitSlop={8}
                      onPress={() => handleRemove(line)}
                      style={styles.removeBtn}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.danger} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
            <AppText variant="body" color="secondary">
              Group subtotal: {formatRupees(group.subtotal)}
            </AppText>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.totalRow}>
              <AppText variant="subtitle">Total</AppText>
              <AppText variant="title">{formatRupees(cart.overallTotal)}</AppText>
            </View>
            <Button
              label="Proceed to Checkout"
              fullWidth
              disabled={cart.hasValidationErrors}
              onPress={() => router.push("/(app)/checkout")}
            />
            {cart.hasValidationErrors ? (
              <AppText variant="caption" color="danger">
                Remove or fix the highlighted items before checking out.
              </AppText>
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.md },
  groupCard: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  lineRow: { flexDirection: "row", gap: Spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: Radius.md },
  lineBody: { flex: 1, gap: 4 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: 4 },
  removeBtn: { marginLeft: "auto", padding: Spacing.xs },
  footer: { gap: Spacing.sm, paddingTop: Spacing.md },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
