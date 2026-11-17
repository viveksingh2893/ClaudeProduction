import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getCheckoutGroupForAdmin,
  netPayableForOrder,
  selectLivePaymentProofSubmissions,
} from "@kisan4u/orders";
import { getFullName } from "@kisan4u/db";
import { AlertBox, Card, PageContainer, PageHeader, StatusBadge, formatDate } from "@kisan4u/ui";
import { requirePaymentVerificationAccess } from "@/lib/payment-verification-guard";
import { AmountEquationBubble } from "@/components/amount-equation-bubble";
import { ProofDecisionPanel } from "@/components/proof-decision-panel";
import { buildOrderAmountEquation, sumOrderAmountEquations } from "@/lib/order-amount-equation";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";

function KeyValue({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

/**
 * The "Payment Verifier" role's only detail view — deliberately minimal:
 * enough context to judge every screenshot (who, how much, which orders)
 * plus the Approve/Reject controls, and nothing else. Unlike the full
 * admin order detail page (/admin/orders/[id]), there is no status-change
 * form, no cancellation review, no RapidShyp panel, no "accept on behalf
 * of seller" — this role has no permission to reach any of those actions
 * even by guessing a URL (requirePaymentVerificationAccess only grants
 * payment-verification:VIEW/EDIT, nothing on the "orders" module those
 * other actions are gated by).
 *
 * Scoped to the whole CheckoutGroup, not one SellerOrder — a multi-seller
 * cart's buyer made ONE external payment for every seller order in it, so
 * the reviewer needs to see all of them here, not just whichever one
 * happened to be first. A buyer paying in instalments also has several
 * concurrent live screenshots ("slots"), each reviewed independently.
 */
export default async function PaymentVerificationOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePaymentVerificationAccess();
  const { id } = await params;
  const group = await getCheckoutGroupForAdmin(id);
  if (!group) notFound();
  if (group.placedByUserId == null) notFound(); // not a POS order — nothing to verify here

  const equations = group.sellerOrders.map((order) => {
    const netPayable = netPayableForOrder(order);
    const discountAmount = order.charge ? Number(order.charge.promotionalDiscountAmount) : 0;
    return buildOrderAmountEquation({
      paymentMethod: order.paymentMethod,
      netPayable,
      discountAmount,
      customerType: order.customerType,
      allocation: order.paymentAllocations[0] ?? null,
    });
  });
  const equation = sumOrderAmountEquations(equations);
  const amountEquation = {
    prepaidAmount: equation.prepaidAmount.toFixed(2),
    codAmount: equation.codAmount.toFixed(2),
    walletAmount: equation.walletAmount.toFixed(2),
    finalAmount: equation.finalAmount.toFixed(2),
    discountNote: equation.discountNote != null ? equation.discountNote.toFixed(2) : null,
  };

  const isCod = group.sellerOrders.every((o) => o.paymentMethod === "COD");
  const liveSubmissions = selectLivePaymentProofSubmissions(group.paymentProofSubmissions);

  return (
    <PageContainer className="py-8" maxWidth="700px">
      <Link
        href="/admin/payment-verification"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All orders
      </Link>
      <PageHeader
        title={group.groupNumber}
        description={
          <>
            {getFullName(group.customer) ?? group.customer.phone ?? "—"}
            {group.customer.phone && <> ({group.customer.phone})</>}
            {group.placedByUserId && <> · Placed via POS</>}
            {" · "}
            {formatDate(group.createdAt, true)}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            {group.sellerOrders.length > 1 ? `${group.sellerOrders.length} seller orders` : "Order"}
          </div>
          {group.sellerOrders.map((order) => (
            <div key={order.id} className="mb-2 flex items-center justify-between border-b border-border pb-2 last:mb-0 last:border-0 last:pb-0">
              <div>
                <span className="font-semibold text-ink">{order.orderNumber}</span>
                <span className="ml-2 text-xs text-gray-500">{order.seller.shopName}</span>
                <a
                  href={`/api/payment-verification/orders/${order.id}/invoice`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-xs font-bold text-green-700 hover:underline"
                >
                  Invoice
                </a>
              </div>
              <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
            </div>
          ))}
          <KeyValue
            label="Amount to be paid"
            value={<AmountEquationBubble equation={amountEquation} />}
          />
        </Card>

        {isCod ? (
          <AlertBox tone="info" title="Nothing to review">
            This is a Cash on Delivery order — there's no prepaid screenshot to verify.
          </AlertBox>
        ) : liveSubmissions.length === 0 ? (
          <AlertBox tone="info" title="Nothing to review">
            No payment screenshot has been uploaded for this order yet.
          </AlertBox>
        ) : (
          <div className="flex flex-col gap-3">
            {liveSubmissions.map((proof) => (
              <ProofDecisionPanel key={proof.id} checkoutGroupId={group.id} proof={proof} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
