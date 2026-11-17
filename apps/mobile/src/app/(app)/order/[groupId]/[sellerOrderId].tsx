import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AppText, Badge, Button, ErrorState, SafeImage, Screen, SelectField, TextField } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/context/toast-context";
import { getSellerOrder, cancelOrder } from "@/lib/api/orders";
import { downloadInvoice } from "@/lib/download-invoice";
import { OrderProgressBar, OrderTimeline } from "@/components/orders/OrderProgress";
import { ReturnRequestForm } from "@/components/orders/ReturnRequestForm";
import {
  DELIVERY_METHOD_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  orderStatusTone,
} from "@/lib/order-status-labels";
import { Radius, Spacing } from "@/constants/theme";
import type { RefundRequestDTO, SellerOrderDTO } from "@/lib/api/types";

function formatRupees(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// PENDING_PAYMENT / PAYMENT_PARTIALLY_RECEIVED cancel instantly (nothing has
// happened yet); CONFIRMED onward becomes a request the Kisan4U team reviews.
const INSTANT_CANCELLABLE_STATUSES = new Set(["PENDING_PAYMENT", "PAYMENT_PARTIALLY_RECEIVED"]);
const CANCELLABLE_STATUSES = new Set([
  "PENDING_PAYMENT",
  "PAYMENT_PARTIALLY_RECEIVED",
  "CONFIRMED",
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
]);

const REFUND_STATUS_LABEL: Record<string, string> = {
  PENDING: "Return requested — awaiting review",
  APPROVED: "Return approved — refund in progress",
  REJECTED: "Return request rejected",
  REFUNDED: "Refunded",
};

const REFUND_STATUS_TONE: Record<string, "warning" | "info" | "danger" | "success"> = {
  PENDING: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  REFUNDED: "success",
};

function StatusBanner({
  tone,
  children,
}: {
  tone: "warning" | "info" | "success" | "danger";
  children: string;
}) {
  const theme = useTheme();
  const bg = {
    warning: theme.warningBg,
    info: theme.infoBg,
    success: theme.successBg,
    danger: theme.dangerBg,
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <AppText variant="body" color={tone === "info" ? "ink" : tone}>
        {children}
      </AppText>
    </View>
  );
}

export default function OrderDetailScreen() {
  const { groupId, sellerOrderId } = useLocalSearchParams<{
    groupId: string;
    sellerOrderId: string;
  }>();
  const theme = useTheme();
  const toast = useToast();
  const [order, setOrder] = useState<SellerOrderDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"WALLET" | "ORIGINAL_SOURCE">("WALLET");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [returningItemId, setReturningItemId] = useState<string | null>(null);

  async function handleDownloadInvoice() {
    if (!order) return;
    setDownloading(true);
    const result = await downloadInvoice(groupId, sellerOrderId, order.invoiceNumber);
    setDownloading(false);
    if (!result.ok) toast.error(result.error);
  }

  const load = useCallback(async () => {
    const result = await getSellerOrder(groupId, sellerOrderId);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setOrder(result.data.order);
  }, [groupId, sellerOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel() {
    if (reason.trim().length < 3 || !order) return;
    setCancelling(true);
    const result = await cancelOrder(groupId, sellerOrderId, {
      reason: reason.trim(),
      instant: INSTANT_CANCELLABLE_STATUSES.has(order.status),
      ...(order.paymentMethod !== "COD" ? { refundMethod } : {}),
    });
    setCancelling(false);
    if (result.ok) {
      setShowCancelForm(false);
      setReason("");
      toast.success("Cancellation submitted");
      load();
    } else {
      setError(result.error.message);
    }
  }

  if (error && !order) return <ErrorState message={error} onRetry={load} />;
  if (!order) return null;

  const walletApplied = (order.paymentAllocations ?? []).reduce(
    (total, a) => total + Number(a.walletAmountApplied),
    0,
  );
  // Prepaid orders always have captured money to route; COD pre-delivery
  // never does (see cancellationRefundMethodEnum). The server re-validates
  // and ignores the choice if there's actually nothing to refund.
  const needsRefundMethod = order.paymentMethod !== "COD";
  const isInstant = INSTANT_CANCELLABLE_STATUSES.has(order.status);
  const refundRequests: RefundRequestDTO[] = order.refundRequests ?? [];
  const cancelRefund = refundRequests.find((r) => r.orderItemId == null);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <AppText variant="title">#{order.orderNumber}</AppText>
            <AppText variant="caption" color="secondary">
              Placed {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              {order.seller ? ` · ${order.seller.shopName}` : ""}
            </AppText>
          </View>
          <Badge
            label={ORDER_STATUS_LABEL[order.status] ?? order.status}
            tone={orderStatusTone(order.status)}
          />
        </View>

        {/* Progress tracker */}
        <View style={[styles.card, { borderColor: theme.border }]}>
          <OrderProgressBar status={order.status} />
        </View>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="subtitle">Items</AppText>
          {order.items.map((item) => {
            const itemRefund = refundRequests.find((r) => r.orderItemId === item.id);
            return (
              <View key={item.id} style={styles.itemBlock}>
                <View style={styles.itemRow}>
                  <View style={[styles.itemThumb, { borderColor: theme.border, backgroundColor: theme.background }]}>
                    <SafeImage uri={item.productImageUrl} style={styles.itemThumbImg} resizeMode="contain" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="body" numberOfLines={2}>
                      {item.productName}
                    </AppText>
                    {item.variantLabel ? (
                      <AppText variant="caption" color="secondary">
                        {item.variantLabel}
                      </AppText>
                    ) : null}
                    <AppText variant="caption" color="secondary">
                      Qty {item.quantity} × {formatRupees(item.unitPrice)}
                    </AppText>
                  </View>
                  <AppText variant="bodyBold">{formatRupees(item.subtotal)}</AppText>
                </View>

                {order.status === "DELIVERED" ? (
                  itemRefund ? (
                    <Badge
                      label={REFUND_STATUS_LABEL[itemRefund.status] ?? itemRefund.status}
                      tone={REFUND_STATUS_TONE[itemRefund.status] ?? "neutral"}
                    />
                  ) : returningItemId === item.id ? (
                    <ReturnRequestForm
                      groupId={groupId}
                      sellerOrderId={sellerOrderId}
                      orderItemId={item.id}
                      paymentMethod={order.paymentMethod}
                      onCancel={() => setReturningItemId(null)}
                      onDone={() => {
                        setReturningItemId(null);
                        load();
                      }}
                    />
                  ) : (
                    <Button
                      label="Request return"
                      variant="outline"
                      onPress={() => setReturningItemId(item.id)}
                    />
                  )
                ) : null}
              </View>
            );
          })}
          <View style={styles.summaryRow}>
            <AppText variant="bodyBold">Total</AppText>
            <AppText variant="title">{formatRupees(order.totalAmount)}</AppText>
          </View>
        </View>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="subtitle">Payment &amp; delivery</AppText>
          <View style={styles.summaryRow}>
            <AppText variant="body" color="secondary">
              Payment method
            </AppText>
            <AppText variant="body">
              {PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
            </AppText>
          </View>
          <View style={styles.summaryRow}>
            <AppText variant="body" color="secondary">
              Delivery method
            </AppText>
            <AppText variant="body">
              {DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
            </AppText>
          </View>
          {order.transportNote ? (
            <View>
              <AppText variant="body" color="secondary">
                Transport note
              </AppText>
              <AppText variant="body">{order.transportNote}</AppText>
            </View>
          ) : null}
          {order.charge ? (
            <>
              {Number(order.charge.transportationCost) > 0 ? (
                <View style={styles.summaryRow}>
                  <AppText variant="body" color="secondary">
                    Transportation charge
                  </AppText>
                  <AppText variant="body">{formatRupees(order.charge.transportationCost)}</AppText>
                </View>
              ) : null}
              {Number(order.charge.promotionalDiscountAmount) > 0 ? (
                <View style={styles.summaryRow}>
                  <AppText variant="body" color="success">
                    Prepaid discount
                  </AppText>
                  <AppText variant="body" color="success">
                    − {formatRupees(order.charge.promotionalDiscountAmount)}
                  </AppText>
                </View>
              ) : null}
              <View style={styles.summaryRow}>
                <AppText variant="bodyBold">Amount payable</AppText>
                <AppText variant="bodyBold">
                  {formatRupees(order.charge.customerPayableTotal)}
                </AppText>
              </View>
            </>
          ) : null}
          {walletApplied > 0 ? (
            <View style={styles.summaryRow}>
              <AppText variant="body" color="success">
                Kisan4U Wallet applied
              </AppText>
              <AppText variant="body" color="success">
                − {formatRupees(walletApplied)}
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <View style={styles.cardTitleRow}>
            <AppText variant="subtitle">Invoice</AppText>
            <AppText variant="caption" color="secondary">
              {order.invoiceNumber}
            </AppText>
          </View>
          <Button
            label="Download invoice (PDF)"
            variant="outline"
            onPress={handleDownloadInvoice}
            loading={downloading}
          />
        </View>

        <View style={[styles.card, { borderColor: theme.border }]}>
          <AppText variant="subtitle" style={{ marginBottom: Spacing.xs }}>
            Order timeline
          </AppText>
          <OrderTimeline entries={order.statusHistory} />
        </View>

        {/* Cancellation / return / refund status */}
        {order.status === "CANCELLATION_REQUESTED" ? (
          <StatusBanner tone="warning">
            Your cancellation request is awaiting review.
          </StatusBanner>
        ) : null}
        {order.status === "CANCELLED" && cancelRefund ? (
          <StatusBanner
            tone={
              cancelRefund.status === "REFUNDED"
                ? "success"
                : cancelRefund.status === "APPROVED"
                  ? "info"
                  : "warning"
            }
          >
            {cancelRefund.status === "REFUNDED"
              ? "Your order was cancelled and your refund is complete."
              : cancelRefund.status === "APPROVED"
                ? "Your order was cancelled — your refund is being processed."
                : "Your order was cancelled — your refund is awaiting review."}
          </StatusBanner>
        ) : null}
        {order.status === "RETURN_REQUESTED" ? (
          <StatusBanner tone="warning">Your return request is awaiting review.</StatusBanner>
        ) : null}
        {order.status === "RETURN_APPROVED" || order.status === "REFUND_INITIATED" ? (
          <StatusBanner tone="info">
            Your return was approved — your refund is being processed.
          </StatusBanner>
        ) : null}
        {order.status === "REFUND_COMPLETED" ? (
          <StatusBanner tone="success">Your refund has been completed.</StatusBanner>
        ) : null}

        {error && order ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}

        {CANCELLABLE_STATUSES.has(order.status) &&
          (showCancelForm ? (
            <View style={[styles.card, { borderColor: theme.border }]}>
              <AppText variant="subtitle">
                {isInstant ? "Cancel order" : "Request cancellation"}
              </AppText>
              <TextField
                label="Reason for cancellation"
                value={reason}
                onChangeText={setReason}
                placeholder="Tell us why"
                multiline
              />
              {needsRefundMethod ? (
                <SelectField
                  label="Refund the amount you've already paid to"
                  value={refundMethod}
                  options={[
                    { label: "Kisan4U Wallet", value: "WALLET" },
                    { label: "Same account I paid with", value: "ORIGINAL_SOURCE" },
                  ]}
                  onChange={(v) => setRefundMethod(v as "WALLET" | "ORIGINAL_SOURCE")}
                />
              ) : null}
              {isInstant && needsRefundMethod ? (
                <AppText variant="caption" color="secondary">
                  Your order is cancelled right away and the refund is sent to your chosen
                  destination automatically.
                </AppText>
              ) : null}
              <Button
                label={isInstant ? "Cancel order now" : "Submit cancellation request"}
                variant="danger"
                onPress={handleCancel}
                loading={cancelling}
                disabled={reason.trim().length < 3}
              />
              <Button label="Never mind" variant="ghost" onPress={() => setShowCancelForm(false)} />
            </View>
          ) : (
            <Button
              label={isInstant ? "Cancel order" : "Request cancellation"}
              variant="outline"
              onPress={() => setShowCancelForm(true)}
            />
          ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Spacing.sm },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemBlock: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  itemRow: { flexDirection: "row", gap: Spacing.sm, alignItems: "center" },
  itemThumb: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  itemThumbImg: { width: "100%", height: "100%" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  banner: { borderRadius: Radius.md, padding: Spacing.md },
});
