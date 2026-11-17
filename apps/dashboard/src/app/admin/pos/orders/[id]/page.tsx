import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { getFullName } from "@kisan4u/db";
import {
  getCheckoutGroupForPlacedBy,
  resolveOrderItemImageUrls,
  netPayableForOrder,
  paidSoFarFor,
  round2,
  selectLivePaymentProofSubmissions,
  requiredPaymentProofAmount,
} from "@kisan4u/orders";
import {
  Card,
  OrderItemSummary,
  PageContainer,
  PageHeader,
  StatusBadge,
  formatCurrency,
  formatDate,
} from "@kisan4u/ui";
import { requirePosAccess } from "@/lib/pos-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-status-labels";
import { PaymentProofPanel } from "./payment-proof-panel";

export default async function PosOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePosAccess();
  const { id } = await params;
  const group = await getCheckoutGroupForPlacedBy(session.user.id, id);
  if (!group) notFound();

  const address = group.addressSnapshot;
  const payment = group.payments[0] ?? null;
  const liveSubmissions = selectLivePaymentProofSubmissions(group.paymentProofSubmissions).map((s) => ({
    id: s.id,
    status: s.status,
    rejectionReason: s.rejectionReason,
    amount: Number(s.amount),
    uploadedAt: s.uploadedAt,
  }));
  // payment.totalAmount/amountPaid are deliberately scoped to only the
  // upfront charge attempted at checkout — for ONLINE_PARTIAL that's just
  // the advance, never the full order total (see checkout.ts's
  // chargeAmount and payment-collection.ts's own doc comment). Reading
  // them directly here showed "Outstanding (due on delivery): ₹0" right
  // after a POS partial-payment checkout, even though a real COD/deferred
  // balance was still due — computed from each seller order's real
  // netPayable/paidSoFar instead, same functions the seller/admin order
  // pages already use correctly.
  const trueTotal = round2(group.sellerOrders.reduce((sum, so) => sum + netPayableForOrder(so), 0));
  const truePaid = round2(
    group.sellerOrders.reduce((sum, so) => sum + paidSoFarFor(so.paymentAllocations), 0),
  );
  const outstanding = round2(Math.max(0, trueTotal - truePaid));
  const walletApplied = payment ? Number(payment.walletAmountApplied) : 0;
  // What payment-proof screenshots must cover — the wallet already funds
  // its own share of chargeAmount, so screenshots only need to prove the
  // remainder, never the wallet-covered portion again.
  const proofRequiredAmount = payment ? requiredPaymentProofAmount(payment) : 0;

  const allItems = group.sellerOrders.flatMap((o) => o.items.map((item) => ({ ...item, key: item.id })));
  const imageByItemId = new Map(
    [...(await resolveOrderItemImageUrls(allItems))].map(([key, url]) => [
      key,
      resolveStorefrontAssetUrl(url),
    ]),
  );

  return (
    <PageContainer className="py-8" maxWidth="800px">
      <Link
        href="/admin/pos/orders"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        My POS orders
      </Link>
      <PageHeader
        title={group.groupNumber}
        description={
          <>
            {getFullName(group.customer) ?? group.customer.phone ?? "—"} ({group.customer.phone})
            {" · "}
            {formatDate(group.createdAt)}
          </>
        }
      />

      <div className="flex flex-col gap-6">
        {address && (
          <Card className="p-4 text-sm text-ink">
            {address.fullName} · {address.mobile}
            <br />
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ""}, {address.cityTown}, {address.district},{" "}
            {address.state} - {address.pincode}
          </Card>
        )}

        <div className="flex flex-col gap-3">
          {group.sellerOrders.map((order) => (
            <Card key={order.id} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-ink">{order.orderNumber}</span>
                <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
              </div>
              <div className="flex flex-col gap-2">
                {order.items.map((item) => (
                  <OrderItemSummary
                    key={item.id}
                    size="sm"
                    imageUrl={imageByItemId.get(item.id) ?? null}
                    name={item.productName}
                    variantLabel={item.variantLabel}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <a
                  href={`/api/pos/orders/${order.id}/invoice`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-green-700 hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Invoice
                </a>
                <span className="text-sm font-bold text-ink">
                  {formatCurrency(order.totalAmount.toString())}
                </span>
              </div>
            </Card>
          ))}
        </div>

        {payment && (
          <Card className="p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Payment method</span>
              <span className="font-semibold text-ink">
                {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Collected so far</span>
              <span className="font-semibold text-ink">{formatCurrency(truePaid.toFixed(2))}</span>
            </div>
            {walletApplied > 0.005 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Wallet applied</span>
                <span className="font-semibold text-ink">{formatCurrency(walletApplied.toFixed(2))}</span>
              </div>
            )}
            {outstanding > 0.005 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Outstanding (due on delivery)</span>
                <span className="font-semibold text-ink">{formatCurrency(outstanding.toFixed(2))}</span>
              </div>
            )}
          </Card>
        )}

        {payment && payment.method !== "COD" && (
          <PaymentProofPanel
            checkoutGroupId={group.id}
            orderTotal={proofRequiredAmount}
            submissions={liveSubmissions}
          />
        )}
      </div>
    </PageContainer>
  );
}
