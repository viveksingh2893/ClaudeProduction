import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCheckoutGroupForCustomer,
  resolveOrderItemImageUrls,
  netPayableForOrder,
  round2,
} from "@kisan4u/orders";
import {
  AlertBox,
  Breadcrumbs,
  Card,
  OrderItemSummary,
  PageContainer,
  SectionHeader,
  StatusBadge,
} from "@kisan4u/ui";

const MAX_ITEMS_SHOWN = 2;
import { requireBuyerContext } from "@/lib/buyer-context";
import { MetaPurchase } from "@/components/meta/meta-checkout-events";
import type { MetaCartSummary } from "@/lib/meta/shared";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
} from "@/lib/order-status-labels";

export default async function CheckoutGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const ctx = await requireBuyerContext();
  const { groupId } = await params;
  const { placed } = await searchParams;
  const group = await getCheckoutGroupForCustomer(ctx.userId, groupId);
  if (!group) notFound();

  const address = group.addressSnapshot;
  const allItems = group.sellerOrders.flatMap((so) => so.items.map((item) => ({ ...item, key: item.id })));
  const imageByItemId = await resolveOrderItemImageUrls(allItems);
  // Meta "Purchase" — only on the ?placed=1 landing right after checkout,
  // and not for a checkout that was cancelled (e.g. payment abandoned).
  const liveOrders = group.sellerOrders.filter((so) => so.status !== "CANCELLED");
  const purchaseCart: MetaCartSummary | null =
    placed && liveOrders.length > 0
      ? {
          contents: liveOrders.flatMap((so) =>
            so.items.map((item) => ({
              id: item.sku,
              quantity: item.quantity,
              item_price: Number(item.unitPrice),
            })),
          ),
          value: round2(liveOrders.reduce((sum, so) => sum + netPayableForOrder(so), 0)),
        }
      : null;

  return (
    <PageContainer maxWidth="900px" className="py-8">
      {purchaseCart && (
        <MetaPurchase checkoutGroupId={group.id} orderNumber={group.groupNumber} cart={purchaseCart} />
      )}
      {placed && (
        <div className="mb-4">
          <AlertBox tone="success" title="Order placed successfully!">
            You&apos;ll get updates on delivery status here.
          </AlertBox>
        </div>
      )}

      <div className="mb-4">
        <Breadcrumbs items={[{ label: "Orders", href: "/orders" }, { label: group.groupNumber }]} />
      </div>

      <h1 className="text-2xl font-extrabold text-green-800">{group.groupNumber}</h1>
      <p className="mt-1 text-sm text-gray-600">
        Placed on {new Date(group.createdAt).toLocaleString()}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {address && (
          <Card className="p-5">
            <SectionHeader title="Delivery Address" />
            <p className="text-sm leading-relaxed text-ink">
              {address.fullName} · {address.mobile}
              <br />
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
              {address.landmark ? `, near ${address.landmark}` : ""}
              <br />
              {address.cityTown}, {address.district}, {address.state} - {address.pincode}
            </p>
          </Card>
        )}

        {group.payments.map((payment) => {
          // Payment.totalAmount/amountPaid are deliberately scoped to only
          // the upfront charge attempted at checkout time — for
          // ONLINE_PARTIAL that's just the advance, never the full order
          // total (see packages/orders/src/checkout.ts's chargeAmount and
          // payment-collection.ts's own doc comment for why). Any COD
          // balance or deferred remainder collected later lives on each
          // PaymentAllocation.remainingCollectedAmount instead — reading
          // payment.totalAmount/amountPaid directly here understated the
          // true order amount and never reflected money collected after
          // checkout (the actual bug: a delivered, fully-collected
          // ONLINE_PARTIAL order still showed the checkout-time advance
          // as "the total" and kept the static remainingDueNote forever,
          // since that note is written once at checkout and never
          // updated). Recomputed live from each allocation's matching
          // seller order instead, same figures the seller/admin pages
          // already compute correctly.
          const trueTotal = round2(
            payment.allocations.reduce((sum, a) => {
              const sellerOrder = group.sellerOrders.find((so) => so.id === a.sellerOrderId);
              return sum + (sellerOrder ? netPayableForOrder(sellerOrder) : Number(a.amount));
            }, 0),
          );
          const truePaid = round2(
            payment.allocations.reduce(
              (sum, a) =>
                sum +
                Number(a.amount) * (Number(payment.amountPaid) / Number(payment.totalAmount || 1)) +
                Number(a.remainingCollectedAmount),
              0,
            ),
          );
          const outstanding = round2(Math.max(0, trueTotal - truePaid));

          return (
            <Card key={payment.id} className="p-5">
              <SectionHeader title="Payment" />
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-ink">
                  {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}
                </span>
                <StatusBadge status={payment.status} label={PAYMENT_STATUS_LABEL[payment.status]} />
              </div>
              <p className="mt-1.5 text-sm text-gray-600">
                Amount: ₹{trueTotal.toFixed(2)} · Paid so far: ₹{truePaid.toFixed(2)}
              </p>
              {outstanding > 0.01 && (
                <p className="mt-1 text-sm text-warning">
                  Remaining ₹{outstanding.toFixed(2)} due on delivery
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <SectionHeader title="Seller Orders" />
        <div className="flex flex-col gap-3">
          {group.sellerOrders.map((sellerOrder) => (
            <Card key={sellerOrder.id} className="p-5 transition-shadow hover:shadow-card">
              <Link href={`/orders/${group.id}/${sellerOrder.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-ink">{sellerOrder.orderNumber}</span>
                  <StatusBadge
                    status={sellerOrder.status}
                    label={ORDER_STATUS_LABEL[sellerOrder.status]}
                  />
                </div>
                <div className="mt-1 text-sm text-gray-600">
                  Sold by {sellerOrder.seller.shopName}
                </div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {sellerOrder.items.slice(0, MAX_ITEMS_SHOWN).map((item) => (
                    <OrderItemSummary
                      key={item.id}
                      size="sm"
                      imageUrl={imageByItemId.get(item.id)}
                      name={item.productName}
                      variantLabel={item.variantLabel}
                      quantity={item.quantity}
                    />
                  ))}
                  {sellerOrder.items.length > MAX_ITEMS_SHOWN && (
                    <span className="pl-[52px] text-xs text-gray-500">
                      +{sellerOrder.items.length - MAX_ITEMS_SHOWN} more item
                      {sellerOrder.items.length - MAX_ITEMS_SHOWN > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </Link>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">
                  {sellerOrder.items.length} item(s) · ₹{sellerOrder.totalAmount.toString()}
                </span>
                <a
                  href={`/api/orders/${sellerOrder.id}/invoice`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-green-700 hover:underline"
                >
                  Download Invoice
                </a>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
