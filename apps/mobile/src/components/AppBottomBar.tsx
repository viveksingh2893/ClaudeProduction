import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useCart } from "@/context/cart-context";
import { useT } from "@/context/language-context";
import { useTheme } from "@/hooks/use-theme";
import { tapFeedback } from "@/lib/haptics";
import { Radius } from "@/constants/theme";

/**
 * The floating bottom nav pill rendered on sub-screens that live OUTSIDE
 * the `(tabs)` navigator (category / subcategory / brand pages) — so the
 * storefront's Home / Categories / Cart / Account bar is present there
 * too, matching the tab screens. Visually identical to the `(tabs)`
 * FloatingTabBar; here it's a plain overlay that navigates with `router`
 * rather than a React Navigation tabBar. `activeKey` lights the item the
 * current sub-screen belongs under.
 */
const BAR_HEIGHT = 64;
const BAR_SIDE_INSET = 16;
const BAR_BOTTOM_GAP = 14;
const BAR_RADIUS = BAR_HEIGHT / 2;
const BAR_FILL = "rgba(243,248,244,0.88)";

type ActiveKey = "home" | "doctor" | "cart" | "account" | "products";

export function AppBottomBar({ activeKey }: { activeKey?: ActiveKey }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { count: cartCount } = useCart();
  const { user } = useAuth();
  const isSeller = user?.role === "SELLER";

  const dests: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] =
    isSeller
      ? [
          { key: "home", label: t("nav.home"), icon: "home-outline", href: "/(app)/(tabs)" },
          { key: "products", label: t("nav.products"), icon: "cube", href: "/(app)/(tabs)/products" },
          { key: "cart", label: t("nav.cart"), icon: "cart", href: "/(app)/(tabs)/cart" },
          { key: "account", label: t("nav.account"), icon: "person", href: "/(app)/(tabs)/account" },
        ]
      : [
          { key: "home", label: t("nav.home"), icon: "home-outline", href: "/(app)/(tabs)" },
          {
            key: "doctor",
            label: t("nav.doctor"),
            icon: "medkit",
            href: "/(app)/(tabs)/doctor",
          },
          { key: "cart", label: t("nav.cart"), icon: "cart", href: "/(app)/(tabs)/cart" },
          { key: "account", label: t("nav.account"), icon: "person", href: "/(app)/(tabs)/account" },
        ];

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View
        style={[
          styles.bar,
          {
            marginBottom: insets.bottom + BAR_BOTTOM_GAP,
            backgroundColor: BAR_FILL,
            borderColor: theme.border,
            shadowColor: theme.green900,
          },
        ]}
      >
        {dests.map((d) => {
          const focused = d.key === activeKey;
          const color = focused ? theme.green700 : theme.textSecondary;
          const showBadge = d.key === "cart" && cartCount > 0;
          return (
            <Pressable
              key={d.key}
              onPress={() => {
                tapFeedback();
                router.navigate(d.href as never);
              }}
              style={styles.item}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={d.label}
            >
              <View>
                <View
                  style={[
                    styles.pill,
                    focused ? { backgroundColor: theme.green50, borderColor: theme.green500 } : null,
                  ]}
                >
                  <Ionicons name={d.icon} color={color} size={20} />
                </View>
                {showBadge ? (
                  <View style={[styles.badge, { backgroundColor: theme.earth600 }]}>
                    <AppText style={styles.badgeText} color="white">
                      {cartCount > 99 ? "99+" : String(cartCount)}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText style={[styles.label, { color }]} numberOfLines={1}>
                {d.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: BAR_SIDE_INSET,
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    paddingHorizontal: 8,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6 },
  pill: {
    minWidth: 56,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  label: { fontSize: 11, fontWeight: "700" },
  badge: {
    position: "absolute",
    top: -6,
    right: -13,
    minWidth: 18,
    height: 18,
    borderRadius: Radius.pill,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
