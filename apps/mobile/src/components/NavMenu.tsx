import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { AppText, Button, SafeImage } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useCart } from "@/context/cart-context";
import { useCategories } from "@/context/categories-context";
import { useTheme } from "@/hooks/use-theme";
import { getFullName } from "@/lib/get-full-name";
import { Radius, Spacing } from "@/constants/theme";

type MenuItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: Href;
  url?: string;
  badge?: number;
};

/**
 * The hamburger drawer — the mobile take on the website's top-nav / mobile
 * menu (apps/web/src/lib/nav-links.ts + category-nav.tsx). Slides in from
 * the right over a dimmed backdrop: an identity header (real name / role,
 * or a "Guest" card with a Log in CTA), the shop links (with a live cart
 * count), the full category list, then secondary links.
 */
export function NavMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { user, isGuest, dealerApplication } = useAuth();
  const { count: cartCount } = useCart();
  const categories = useCategories();
  const isDealer = user?.role === "DEALER";
  const name = user && !isGuest ? getFullName(user) : null;

  // "Become a Dealer" row: hidden for an approved dealer and for guests
  // (they must verify a number first); otherwise the label tracks the
  // application state, and every variant opens the same form screen.
  const dealerRow: MenuItem | null =
    isDealer || isGuest
      ? null
      : {
          label:
            dealerApplication?.status === "PENDING"
              ? "Dealer application: Pending"
              : dealerApplication?.status === "REJECTED"
                ? "Dealer application: Rejected"
                : "Become a Dealer",
          icon: "ribbon-outline",
          href: "/(app)/become-dealer",
        };

  function go(item: MenuItem) {
    onClose();
    if (item.url) {
      Linking.openURL(item.url).catch(() => {});
    } else if (item.href) {
      router.push(item.href);
    }
  }

  const shopLinks: MenuItem[] = [
    { label: "Home", icon: "home-outline", href: "/(app)/(tabs)" },
    { label: "All Products", icon: "pricetags-outline", href: "/(app)/(tabs)/shop" },
    { label: "Cart", icon: "cart-outline", href: "/(app)/(tabs)/cart", badge: cartCount },
  ];

  const accountLinks: MenuItem[] = isGuest
    ? []
    : [
        { label: "My Orders", icon: "receipt-outline", href: "/(app)/(tabs)/orders" },
        { label: "Wishlist", icon: "heart-outline", href: "/(app)/wishlist" },
        { label: "Saved Addresses", icon: "location-outline", href: "/(app)/addresses" },
        { label: "Kisan4U Wallet", icon: "wallet-outline", href: "/(app)/wallet" },
        ...(isDealer
          ? [
              {
                label: "My Product Requests",
                icon: "document-text-outline" as const,
                href: "/(app)/dealer-requests" as Href,
              },
            ]
          : []),
        { label: "Account", icon: "person-outline", href: "/(app)/(tabs)/account" },
      ];

  const secondary: MenuItem[] = [
    ...(dealerRow ? [dealerRow] : []),
    { label: "Talk to us", icon: "chatbubbles-outline", href: "/(app)/more/call-centre" },
    { label: "Corporate Website", icon: "open-outline", url: "https://corporate.kisan4u.com/" },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panel, { backgroundColor: theme.background }]}>
        {/* Identity header */}
        <View style={[styles.header, { backgroundColor: theme.green700 }]}>
          <View style={styles.headerTop}>
            <View style={[styles.headerAvatar, { backgroundColor: theme.onGreen }]}>
              <Ionicons name="person" size={24} color={theme.green700} />
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.headerClose}>
              <Ionicons name="close" size={22} color={theme.onGreen} />
            </Pressable>
          </View>
          {isGuest ? (
            <>
              <AppText color="white" variant="subtitle">
                Browsing as guest
              </AppText>
              <AppText color="white" variant="caption" style={styles.headerSub}>
                Log in to track orders, save addresses & use your wallet.
              </AppText>
              <View style={styles.headerCta}>
                <Button
                  label="Log in / Sign up"
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    onClose();
                    router.push("/(auth)/welcome");
                  }}
                />
              </View>
            </>
          ) : (
            <>
              <AppText color="white" variant="subtitle">
                {name ? `Hello, ${name}` : "Hello"}
              </AppText>
              <AppText color="white" variant="caption" style={styles.headerSub}>
                {isDealer ? "Dealer account" : "Customer account"}
              </AppText>
            </>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Group theme={theme} items={shopLinks} onPress={go} />
          {accountLinks.length > 0 ? (
            <>
              <SectionLabel theme={theme}>YOUR ACCOUNT</SectionLabel>
              <Group theme={theme} items={accountLinks} onPress={go} />
            </>
          ) : null}

          {categories.length > 0 ? (
            <>
              <SectionLabel theme={theme}>SHOP BY CATEGORY</SectionLabel>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {categories.map((c, i) => (
                  <Pressable
                    key={c.id}
                    style={[
                      styles.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    ]}
                    onPress={() => {
                      onClose();
                      router.push({ pathname: "/(app)/category/[slug]", params: { slug: c.slug } });
                    }}
                  >
                    <View style={[styles.iconChip, { backgroundColor: theme.green50 }]}>
                      {c.emoji ? (
                        <AppText style={styles.emoji}>{c.emoji}</AppText>
                      ) : c.imageUrl ? (
                        <SafeImage uri={c.imageUrl} style={styles.chipImg} resizeMode="cover" />
                      ) : (
                        <AppText color="green" style={styles.emoji}>
                          {c.name.charAt(0)}
                        </AppText>
                      )}
                    </View>
                    <AppText variant="body" style={styles.rowLabel} numberOfLines={1}>
                      {c.name}
                    </AppText>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <SectionLabel theme={theme}>MORE</SectionLabel>
          <Group theme={theme} items={secondary} onPress={go} />

          <View style={{ height: Spacing.xl }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionLabel({
  theme,
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  children: string;
}) {
  return (
    <AppText variant="label" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
      {children}
    </AppText>
  );
}

function Group({
  theme,
  items,
  onPress,
}: {
  theme: ReturnType<typeof useTheme>;
  items: MenuItem[];
  onPress: (item: MenuItem) => void;
}) {
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {items.map((item, i) => (
        <Pressable
          key={item.label}
          style={[
            styles.row,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
          ]}
          onPress={() => onPress(item)}
        >
          <View style={[styles.iconChip, { backgroundColor: theme.green50 }]}>
            <Ionicons name={item.icon} size={18} color={theme.green700} />
          </View>
          <AppText variant="body" style={styles.rowLabel}>
            {item.label}
          </AppText>
          {item.badge && item.badge > 0 ? (
            <View style={[styles.countPill, { backgroundColor: theme.earth600 }]}>
              <AppText variant="label" color="white" style={styles.countPillText}>
                {item.badge > 99 ? "99+" : item.badge}
              </AppText>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: "86%",
    maxWidth: 380,
  },
  header: {
    paddingTop: Spacing.xl + Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: 4,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  headerAvatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  headerClose: { padding: 4 },
  headerSub: { opacity: 0.9 },
  headerCta: { marginTop: Spacing.sm, alignSelf: "flex-start" },
  body: { padding: Spacing.lg, gap: Spacing.xs },
  sectionLabel: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    marginLeft: Spacing.xs,
    letterSpacing: 0.5,
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
  },
  rowLabel: { flex: 1 },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  chipImg: { width: "100%", height: "100%" },
  emoji: { fontSize: 16 },
  countPill: {
    minWidth: 20,
    height: 20,
    borderRadius: Radius.pill,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  countPillText: { fontSize: 10 },
});
