import { notFound } from "next/navigation";
import { getSellerOrderForCustomer, resolveOrderItemImageUrls, nonWalletPaidSoFarFor } from "@kisan4u/orders";
import {
  AlertBox,
  Breadcrumbs,
  Card,
  OrderItemSummary,
  OrderStatusTimeline,
  PageContainer,
  SectionHeader,
  StatusBadge,
} from "@kisan4u/ui";
import { requireBuyerContext } from "@/lib/buyer-context";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  DELIVERY_METHOD_LABEL,
} from "@/lib/order-status-labels";
import { CancelOrderButton } from "./cancel-order-button";
import { RequestReturnButton } from "./request-return-button";

// PENDING_PAYMENT / PAYMENT_PARTIALLY_RECEIVED cancel instantly (no admin
// review — nothing has happened yet); CONFIRMED onward is a request the
// Kisan4U team approves. See CancelOrderButton's `instant` prop.
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

export default async function SellerOrderPage({
  params,
}: {
  params: Promise<{ groupId: string; sellerOrderId: string }>;
}) {
  const ctx = await requireBuyerContext();
  const { groupId, sellerOrderId } = await params;
  const order = await getSellerOrderForCustomer(ctx.userId, sellerOrderId);
  if (!order || order.checkoutGroupId !== groupId) notFound();

  const walletApplied = order.paymentAllocations.reduce(
    (total, allocation) => total + Number(allocation.walletAmountApplied),
    0,
  );
  // Whether cancelling this order right now would leave real, non-wallet
  // money to refund — CancelOrderButton only asks for a refund method
  // when this is > 0 (an unpaid COD order or a fully wallet-funded one
  // has nothing here to pick a method for). See cancellation.ts's
  // requestCancellation, the actual authority this mirrors.
  const nonWalletPaid = nonWalletPaidSoFarFor(order.paymentAllocations);
  const imageByItemId = await resolveOrderItemImageUrls(
    order.items.map((item) => ({ ...item, key: item.id })),
  );

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Orders", href: "/orders" },
            { label: order.checkoutGroup.groupNumber, href: `/orders/${groupId}` },
            { label: order.orderNumber },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold text-green-800">{order.orderNumber}</h1>
          <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
        </div>
        <a
          href={`/api/orders/${order.id}/invoice`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold text-green-700 hover:underline"
        >
          Download Invoice
        </a>
      </div>
      <p className="mt-1 text-sm text-gray-600">Sold by {order.seller.shopName}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="Items" />
          <div className="flex flex-col divide-y divide-border">
            {order.items.map((item) => {
              // Most recent request for this item — PENDING/APPROVED block a
              // new one (see requestReturn's own check), REJECTED/REFUNDED
              // are past history but still shown rather than re-offering the
              // button as if nothing happened.
              const refundRequest = order.refundRequests.find((r) => r.orderItemId === item.id);
              return (
                <div key={item.id} className="py-3">
                  <OrderItemSummary
                    imageUrl={imageByItemId.get(item.id)}
                    name={item.productName}
                    variantLabel={item.variantLabel}
                    sku={item.sku}
                    trailing={
                      <span className="text-sm font-bold text-ink">₹{item.subtotal.toString()}</span>
                    }
                  />
                  <div className="mt-1 pl-[68px] text-xs text-gray-600">
                    {item.quantity} × ₹{item.unitPrice.toString()} ({item.unit})
                  </div>
                  {order.status === "DELIVERED" && (
                    <div className="pl-[68px]">
                      {refundRequest ? (
                        <span className="text-xs font-semibold text-ink">
                          {REFUND_STATUS_LABEL[refundRequest.status] ?? refundRequest.status}
                        </span>
                      ) : (
                        <RequestReturnButton
                          sellerOrderId={order.id}
                          orderItemId={item.id}
                          paymentMethod={order.paymentMethod}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Charge Breakdown" />
          <div className="flex flex-col gap-1.5 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Product subtotal</span>
              <span className="font-semibold text-ink">₹{order.subtotal.toString()}</span>
            </div>
            {Number(order.discountAmount) > 0 && (
              <div className="flex justify-between text-success">
                <span>Discount</span>
                <span>−₹{order.discountAmount.toString()}</span>
              </div>
            )}
            {Number(order.taxAmount) > 0 && (
              <div className="flex justify-between">
                <span>Tax</span>
                <span>₹{order.taxAmount.toString()}</span>
              </div>
            )}
            {order.charge && (
              <>
                <div className="flex justify-between">
                  <span>
                    Delivery method:{" "}
                    {DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod} ·{" "}
                    {order.charge.shipmentWeightGrams} g
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>You pay for delivery</span>
                  <span className="font-semibold text-ink">
                    ₹{order.charge.customerPayableDelivery.toString()}
                  </span>
                </div>
                {Number(order.charge.promotionalDiscountAmount) > 0 && (
                  <div className="flex justify-between text-success">
                    <span>
                      {order.charge.promotionalDiscountPercent.toString()}% online payment discount
                    </span>
                    <span>−₹{order.charge.promotionalDiscountAmount.toString()}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-extrabold text-ink">
              <span>Total</span>
              <span>
                ₹{(order.charge ? order.charge.customerPayableTotal : order.totalAmount).toString()}
              </span>
            </div>
            <div>
              Payment method: {PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
            </div>
            {walletApplied > 0 && (
              <div className="text-success">
                Kisan4U Wallet applied: −₹{walletApplied.toFixed(2)}
              </div>
            )}
            {order.transportNote && <div>Transport note: {order.transportNote}</div>}
          </div>
        </Card>

        {order.shipment && (
          <Card className="p-5">
            <SectionHeader title="Shipment Tracking" />
            <div className="text-sm text-gray-600">
              AWB: <span className="font-semibold text-ink">{order.shipment.awbNumber ?? "—"}</span>{" "}
              · Status: <span className="font-semibold text-ink">{order.shipment.status}</span>
            </div>
          </Card>
        )}

        <Card className="p-5">
          <SectionHeader title="Status History" />
          <OrderStatusTimeline
            entries={order.statusHistory.map((entry) => ({
              id: entry.id,
              status: entry.status,
              label: ORDER_STATUS_LABEL[entry.status] ?? entry.status,
              createdAt: entry.createdAt,
              note: entry.note,
            }))}
          />
        </Card>
      </div>

      {CANCELLABLE_STATUSES.has(order.status) && (
        <Card className="mt-4 p-5">
          <SectionHeader title="Cancellation" />
          <CancelOrderButton
            sellerOrderId={order.id}
            nonWalletPaid={nonWalletPaid}
            instant={INSTANT_CANCELLABLE_STATUSES.has(order.status)}
          />
        </Card>
      )}
      {order.status === "CANCELLATION_REQUESTED" && (
        <div className="mt-4">
          <AlertBox tone="warning">Your cancellation request is awaiting admin review.</AlertBox>
        </div>
      )}
      {order.status === "CANCELLED" &&
        (() => {
          const cancelRefund = order.refundRequests.find((r) => r.orderItemId == null);
          if (!cancelRefund) return null;
          if (cancelRefund.status === "PENDING")
            return (
              <div className="mt-4">
                <AlertBox tone="warning">
                  Your order was cancelled. Your refund is awaiting review and will be sent once
                  approved.
                </AlertBox>
              </div>
            );
          if (cancelRefund.status === "APPROVED")
            return (
              <div className="mt-4">
                <AlertBox tone="info">Your refund was approved and is being processed.</AlertBox>
              </div>
            );
          if (cancelRefund.status === "REFUNDED")
            return (
              <div className="mt-4">
                <AlertBox tone="success">Your refund has been completed.</AlertBox>
              </div>
            );
          return null;
        })()}
      {order.status === "RETURN_REQUESTED" && (
        <div className="mt-4">
          <AlertBox tone="warning">Your return request is awaiting admin review.</AlertBox>
        </div>
      )}
      {(order.status === "RETURN_APPROVED" || order.status === "REFUND_INITIATED") && (
        <div className="mt-4">
          <AlertBox tone="info">Your return was approved — your refund is being processed.</AlertBox>
        </div>
      )}
      {order.status === "REFUND_COMPLETED" && (
        <div className="mt-4">
          <AlertBox tone="success">Your refund has been completed.</AlertBox>
        </div>
      )}
    </PageContainer>
  );
}
