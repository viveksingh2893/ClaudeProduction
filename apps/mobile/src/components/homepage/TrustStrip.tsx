import { StyleSheet, View } from "react-native";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

/**
 * The four Kisan4U benefits from the storefront homepage
 * (apps/web/src/components/homepage/trust-strip.tsx). Wording is
 * intentionally hardcoded — admin can only show/hide the block, never edit
 * the claims — so it isn't run through i18n, same as the website.
 */
const BENEFITS = [
  { title: "Verified Sellers", desc: "Products from approved marketplace sellers." },
  { title: "Dealer & Bulk Pricing", desc: "Special pricing and quantities for approved dealers." },
  { title: "Reliable Delivery & Tracking", desc: "Transparent delivery options with order updates." },
  { title: "Dedicated Customer Support", desc: "Help with products, orders, returns and reorders." },
];

export function TrustStrip() {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {BENEFITS.map((item) => (
          <View key={item.title} style={styles.cell}>
            <View style={[styles.badge, { backgroundColor: theme.green600 }]}>
              <AppText color="white" style={styles.badgeText}>
                {item.title.charAt(0)}
              </AppText>
            </View>
            <AppText variant="bodyBold" style={styles.center}>
              {item.title}
            </AppText>
            <AppText variant="caption" color="secondary" style={styles.center}>
              {item.desc}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: Spacing.lg, columnGap: Spacing.md },
  cell: { width: "47%", alignItems: "center", gap: Spacing.xs },
  badge: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 17, fontWeight: "800" },
  center: { textAlign: "center" },
});
