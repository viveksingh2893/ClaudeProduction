import { StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { Badge } from "./Badge";
import { Spacing } from "@/constants/theme";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** mrp/sellingPrice arrive from the API as Prisma Decimal → JSON strings; parse once here so every screen doesn't repeat Number(...). */
export function PriceTag({
  mrp,
  sellingPrice,
  size = "md",
}: {
  mrp: number | string | null;
  sellingPrice: number | string | null;
  size?: "md" | "lg";
}) {
  const mrpNum = mrp != null ? Number(mrp) : null;
  const priceNum = sellingPrice != null ? Number(sellingPrice) : null;
  if (priceNum == null) return null;

  const hasDiscount = mrpNum != null && mrpNum > priceNum;
  const discountPercent = hasDiscount ? Math.round(((mrpNum - priceNum) / mrpNum) * 100) : 0;

  return (
    <View style={styles.row}>
      <AppText variant={size === "lg" ? "title" : "bodyBold"}>{formatRupees(priceNum)}</AppText>
      {hasDiscount && (
        <>
          <AppText variant="caption" color="secondary" style={styles.strike}>
            {formatRupees(mrpNum!)}
          </AppText>
          <Badge label={`${discountPercent}% OFF`} tone="success" />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, flexWrap: "wrap" },
  strike: { textDecorationLine: "line-through" },
});
