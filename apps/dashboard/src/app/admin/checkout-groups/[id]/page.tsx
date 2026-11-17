import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getCheckoutGroupForAdmin,
  resolveOrderItemImageUrls,
  netPayableForOrder,
  round2,
} from "@kisan4u/orders";
import { getFullName } from "@kisan4u/db";
import {
  Card,
  OrderItemSummary,
  PageContainer,
  PageHeader,
  StatusBadge,
  formatCurrency,
  formatDate,
} from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
} from "@/lib/order-status-labels";

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-green-800">{title}</h2>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

export default async function AdminCheckoutGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { id } = await params;
  const group = await getCheckoutGroupForAdmin(id);
  if (!group) notFound();

  const allItems = group.sellerOrders.flatMap((so) =>
    so.items.map((item) => ({ ...item, key: item.id })),
  );
  const imageByItemId = new Map(
    [...(await resolveOrderItemImageUrls(allItems))].map(([key, url]) => [
      key,
      resolveStorefrontAssetUrl(url),
    ]),
  );

  const orderCount = group.sellerOrders.length;
  const sellerCount = new Set(group.sellerOrders.map((o) => o.sellerId)).size;
  const itemCount = group.sellerOrders.reduce((sum, o) => sum + o.items.length, 0);
  const totalAmount = group.sellerOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  return (
    <PageContainer className="py-8" maxWidth="1000px">
      <Link
        href="/admin/checkout-groups"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All checkout groups
      </Link>
      <PageHeader
        title={group.groupNumber}
        description={`Placed ${formatDate(group.createdAt, true)} · ${group.customerType === "DEALER" ? "Dealer" : "Customer"}`}
        actions={
          <Link
            href={`/admin/customers/${group.customer.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:underline"
          >
            View customer
          </Link>
        }
      />

      <div className="flex flex-col gap-8">
        <DetailSection title="Summary">
          <Card className="divide-y divide-border p-4">
            <KeyValue
              label="Customer"
              value={`${getFullName(group.customer) ?? "—"} · ${group.customer.phone ?? "—"}`}
            />
            <KeyValue label="Orders" value={orderCount} />
            <KeyValue label="Sellers" value={sellerCount} />
            <KeyValue label="Items" value={itemCount} />
            <KeyValue label="Total amount" value={formatCurrency(totalAmount)} />
          </Card>
        </DetailSection>

        {group.addressSnapshot && (
          <DetailSection title="Delivery address">
            <Card className="p-4 text-sm text-ink">
              {group.addressSnapshot.fullName} · {group.addressSnapshot.mobile}
              <br />
              {group.addressSnapshot.line1}
              {group.addressSnapshot.line2 ? `, ${group.addressSnapshot.line2}` : ""},{" "}
              {group.addressSnapshot.cityTown}, {group.addressSnapshot.district},{" "}
              {group.addressSnapshot.state} - {group.addressSnapshot.pincode}
            </Card>
          </DetailSection>
        )}

        <DetailSection title={`Payment (${group.payments.length})`}>
          {group.payments.length === 0 ? (
            <Card className="p-4 text-sm text-gray-600">No payment recorded.</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {group.payments.map((payment) => {
                // payment.amountPaid/totalAmount are deliberately scoped
                // to only the upfront charge attempted at checkout — for
                // ONLINE_PARTIAL that's just the advance, never the full
                // order total (see checkout.ts's chargeAmount and
                // payment-collection.ts's own doc comment). A COD balance
                // or deferred remainder collected later lives on each
                // PaymentAllocation.remainingCollectedAmount instead —
                // blended in here so a delivered, fully-collected order
                // doesn't still read as only the advance having been paid.
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
                return (
                  <Card key={payment.id} className="p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-gray-600">
                        {payment.internalReference}
                      </span>
                      <StatusBadge status={payment.status} label={PAYMENT_STATUS_LABEL[payment.status]} />
                    </div>
                    <div className="mt-1 text-gray-600">
                      {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}
                    </div>
                    <div className="mt-1 text-ink">
                      Paid {formatCurrency(truePaid.toFixed(2))} of {formatCurrency(trueTotal.toFixed(2))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </DetailSection>

        <DetailSection title={`Seller orders (${orderCount})`}>
          <div className="flex flex-col gap-3">
            {group.sellerOrders.map((sellerOrder) => (
              <Card key={sellerOrder.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/admin/orders/${sellerOrder.id}`}
                    className="font-semibold text-green-700 hover:underline"
                  >
                    {sellerOrder.orderNumber}
                  </Link>
                  <StatusBadge
                    status={sellerOrder.status}
                    label={ORDER_STATUS_LABEL[sellerOrder.status]}
                  />
                </div>
                <div className="mt-1 text-gray-600">Sold by {sellerOrder.seller.shopName}</div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {sellerOrder.items.map((item) => (
                    <OrderItemSummary
                      key={item.id}
                      size="sm"
                      imageUrl={imageByItemId.get(item.id)}
                      name={item.productName}
                      variantLabel={item.variantLabel}
                      quantity={item.quantity}
                    />
                  ))}
                </div>
                <div className="mt-2 font-semibold text-ink">
                  {formatCurrency(sellerOrder.totalAmount.toString())}
                </div>
              </Card>
            ))}
          </div>
        </DetailSection>
      </div>
    </PageContainer>
  );
}
