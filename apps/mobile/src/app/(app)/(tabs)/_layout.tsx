import { type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useCart } from "@/context/cart-context";
import { useT } from "@/context/language-context";
import { useTheme } from "@/hooks/use-theme";
import { tapFeedback } from "@/lib/haptics";
import { Radius } from "@/constants/theme";

/**
 * Bottom nav = the storefront's 4 pill items: Home / Kisan4U Doctor
 * (coming soon) / Cart / Account. Sellers get a Products tab instead of
 * Doctor. "Categories" (the `shop` screen) is no longer a tab — the
 * screen is still registered/routable, it's just not one of the 4
 * destinations in the pill anymore.
 *
 * Rendered by a fully custom `tabBar` — React Navigation's own BottomTabBar
 * is NOT used, so none of its full-width root, hairline top border or
 * Android elevation panel exists. The scene is `backgroundColor:
 * "transparent"` (NOT inset with `sceneStyle.paddingBottom`, which is what
 * used to reveal the navigator's grey theme background as a full-width
 * band under the pill) — so every tab screen fills edge to edge and the
 * page renders/scrolls right behind the pill. Screens add
 * `TAB_BAR_SCENE_INSET` (constants/theme, + their own safe-area inset) to
 * their scroll content so the last row can be scrolled clear of the pill.
 */
const BAR_HEIGHT = 64;
const BAR_SIDE_INSET = 16;
const BAR_BOTTOM_GAP = 14;
/** fully rounded capsule, like the reference. */
const BAR_RADIUS = BAR_HEIGHT / 2;
/** frosted mint-white — no blur (Android blur fringes on a small rounded view); the page shows through faintly at the edges. */
const BAR_FILL = "rgba(243,248,244,0.88)";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export default function TabsLayout() {
  const { user } = useAuth();
  const theme = useTheme();
  const t = useT();
  const isSeller = user?.role === "SELLER";

  const pillActive = { backgroundColor: theme.green50, borderColor: theme.green500 };
  function icon(name: keyof typeof Ionicons.glyphMap) {
    function TabIcon(props: { color: ColorValue; focused: boolean }) {
      return (
        <View style={[styles.pill, props.focused ? pillActive : null]}>
          <Ionicons name={name} color={props.color} size={20} />
        </View>
      );
    }
    return TabIcon;
  }

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.green700,
        tabBarInactiveTintColor: theme.textSecondary,
        // Transparent scene — never inset. The floating pill is absolutely
        // positioned over the full-height screen; page content renders and
        // scrolls behind it. (An inset scene revealed the navigator's grey
        // theme bg as a full-width band under the pill.)
        sceneStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: isSeller ? null : undefined,
          title: t("nav.home"),
          tabBarIcon: icon("home-outline"),
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          // No longer a tab-bar destination — Kisan4U Doctor took its
          // slot in FloatingTabBar below. The route stays registered
          // (and reachable via router.push) because other screens still
          // link to "Browse categories" / "Shop now".
          href: null,
          title: t("nav.categories"),
        }}
      />
      <Tabs.Screen
        name="doctor"
        options={{
          href: isSeller ? null : undefined,
          title: t("nav.doctor"),
          tabBarIcon: icon("medkit"),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          href: isSeller ? null : undefined,
          title: t("nav.cart"),
          tabBarIcon: icon("cart"),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          href: null,
          title: t("nav.orders"),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          href: isSeller ? undefined : null,
          title: t("nav.products"),
          tabBarIcon: icon("cube"),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t("nav.account"),
          tabBarIcon: icon("person"),
        }}
      />
    </Tabs>
  );
}

function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { count: cartCount } = useCart();

  const activeKey = state.routes[state.index]?.key;
  const visible = state.routes.filter((route) => {
    const o = descriptors[route.key]?.options;
    // expo-router marks a `href: null` tab with tabBarButton:()=>null
    // + tabBarItemStyle:{display:'none'} — skip those.
    const hiddenStyle = StyleSheet.flatten(o?.tabBarItemStyle) as { display?: string } | undefined;
    return !o?.tabBarButton && hiddenStyle?.display !== "none";
  });

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
        {visible.map((route) => {
          const { options } = descriptors[route.key];
          const focused = route.key === activeKey;
          const color = focused ? theme.green700 : theme.textSecondary;
          const label =
            typeof options.title === "string" && options.title.length > 0
              ? options.title
              : route.name;
          const iconNode: ReactNode = options.tabBarIcon?.({ focused, color, size: 22 }) ?? null;
          const showBadge = route.name === "cart" && cartCount > 0;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                tapFeedback();
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              style={styles.item}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
            >
              <View>
                {iconNode}
                {showBadge ? (
                  <View style={[styles.badge, { backgroundColor: theme.earth600 }]}>
                    <AppText style={styles.badgeText} color="white">
                      {cartCount > 99 ? "99+" : String(cartCount)}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText style={[styles.label, { color }]} numberOfLines={1}>
                {label}
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
  // Borderless frosted capsule that floats over the page — soft ambient
  // shadow only, exactly like the reference.
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
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
  },
  // The active tab's pale-green capsule chip; inactive tabs keep the same
  // footprint with a transparent border so every icon stays aligned.
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
