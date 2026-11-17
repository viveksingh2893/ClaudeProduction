import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone, Store, Truck, User } from "lucide-react";
import {
  getSellerOrderForAdmin,
  round2,
  resolveOrderItemImageUrls,
  selectLivePaymentProofSubmissions,
  refundChoicesFor,
} from "@kisan4u/orders";
import { getFullName, prisma } from "@kisan4u/db";
import {
  Card,
  OrderItemSummary,
  OrderStatusTimeline,
  PageContainer,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  formatCurrency,
  formatDate,
} from "@kisan4u/ui";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { buildTrackingTimeline } from "@/lib/tracking-timeline";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  DELIVERY_METHOD_LABEL,
} from "@/lib/order-status-labels";
import { AdminOrderActions } from "./admin-order-actions";
import { PaymentSummary, type OnlinePaymentDetail, type PosProofDetail } from "./payment-summary";
import { CustomerOrderHistoryButton } from "./customer-order-history-button";

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-green-800">{title}</h2>
      {children}
    </section>
  );
}

function KeyValue({
  label,
  value,
  emphasis,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={emphasis ? "font-bold text-ink" : "text-ink"}>{value}</span>
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warning" | "success";
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={`text-base font-bold ${
          tone === "warning" ? "text-amber-600" : tone === "success" ? "text-green-700" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOrdersSectionView();
  const { id } = await params;
  const order = await getSellerOrderForAdmin(id);
  if (!order) notFound();

  const address = order.checkoutGroup.addressSnapshot;
  // decideProposedOrder (BA approval flow) reuses the same checkout()
  // placedBy mechanism POS uses, so placedByName alone can't tell a real
  // POS order apart from a BA-approved one — see getSellerOrderForAdmin's
  // placedByUser include and admin-order-row.ts's identical distinction.
  const baProfile = order.checkoutGroup.placedByUser?.baProfile ?? null;
  const isBa = order.placedByUserId != null && baProfile != null;
  const isPos = order.placedByUserId != null && order.checkoutGroup.placedByUser?.staffProfile != null;
  // Status changes now happen inline from the /admin/orders table
  // (AdminInlineStatusControl); the detail page no longer carries a
  // generic "Move to status" dropdown.

  // "Allocated" is this seller order's SHARE of the payment's total amount —
  // since the corrective promo-discount pass, that sums to
  // order.charge.customerPayableTotal (net of any Kisan4u-borne discount),
  // NOT order.totalAmount (the pre-discount gross figure, kept as the
  // seller's own settlement basis) — it is also NOT how much has actually
  // been collected. The amount actually paid toward this seller order must
  // be pro-rated by each payment's own paid ratio (amountPaid / totalAmount),
  // and outstanding is the net payable minus THAT, never minus the
  // allocation itself (which would always show ₹0 due, even for an unpaid
  // COD order — a bug found via manual testing). Plus
  // allocation.remainingCollectedAmount — cash (COD) or a deferred
  // ONLINE_PARTIAL balance collected AFTER the original payment attempt,
  // either automatically on delivery or via the admin's manual "record
  // payment collected" action (see packages/orders/src/payment-collection.ts,
  // which computes this identical figure for its own outstanding check).
  //
  // paidOnlinePortion is the SAME sum minus remainingCollectedAmount — the
  // part of amountPaid that was actually paid through the online/wallet
  // payment attempt itself, as opposed to collected later (COD or a
  // deferred balance). That split is what the new Payment Summary card
  // needs: "Paid Online" only ever shows this portion, never blended with
  // a COD/deferred amount collected afterward.
  const paidOnlinePortion = round2(
    order.paymentAllocations.reduce(
      (total, a) =>
        total + Number(a.amount) * (Number(a.payment.amountPaid) / Number(a.payment.totalAmount || 1)),
      0,
    ),
  );
  const amountPaid = round2(
    paidOnlinePortion + order.paymentAllocations.reduce((t, a) => t + Number(a.remainingCollectedAmount), 0),
  );
  const netPayable = order.charge
    ? Number(order.charge.customerPayableTotal)
    : Number(order.totalAmount);
  const outstanding = round2(netPayable - amountPaid);
  const imageByItemId = new Map(
    [...(await resolveOrderItemImageUrls(order.items.map((item) => ({ ...item, key: item.id }))))].map(
      ([key, url]) => [key, resolveStorefrontAssetUrl(url)],
    ),
  );

  // Representative payment attempt for the "Paid Online" card's
  // method/transaction/paid-on details — in practice a seller order has
  // exactly one real payment attempt, so the first one with anything
  // actually paid on it is the right one to show.
  const onlinePaymentAllocation = order.paymentAllocations.find((a) => Number(a.payment.amountPaid) > 0);
  const onlinePayment: OnlinePaymentDetail | null =
    paidOnlinePortion > 0.005 && onlinePaymentAllocation
      ? {
          amount: paidOnlinePortion,
          methodLabel: PAYMENT_METHOD_LABEL[onlinePaymentAllocation.payment.method] ?? onlinePaymentAllocation.payment.method,
          transactionId:
            onlinePaymentAllocation.payment.razorpayPaymentId ??
            onlinePaymentAllocation.payment.providerReference ??
            onlinePaymentAllocation.payment.internalReference,
          paidOn: onlinePaymentAllocation.payment.updatedAt,
        }
      : null;

  const posCheckoutGroupId =
    isPos && order.paymentMethod !== "COD" ? order.checkoutGroupId : null;
  const liveProofs: PosProofDetail[] = posCheckoutGroupId
    ? selectLivePaymentProofSubmissions(order.checkoutGroup.paymentProofSubmissions).map((s) => ({
        id: s.id,
        status: s.status,
        rejectionReason: s.rejectionReason,
        amount: Number(s.amount),
        uploadedByName: getFullName(s.uploadedBy) ?? "—",
        uploadedAt: s.uploadedAt,
      }))
    : [];

  // The one RefundRequest relevant to this order's current status — see
  // admin-order-actions.tsx's ReviewableRefundRequest doc comment for why
  // at most one is ever active per order. A CANCELLED order carries a
  // whole-order cancellation refund (orderItemId null) that starts PENDING
  // and needs admin approval before the money moves, same as a return. An
  // RTO (RTO_INITIATED/RTO_DELIVERED_TO_SELLER) order carries the same kind
  // of whole-order refund, auto-created once the courier confirms RTO (see
  // order-workflow.ts's applyShipmentStatusTransition).
  const refundRequest =
    order.status === "RETURN_REQUESTED"
      ? order.refundRequests.find((r) => r.status === "PENDING")
      : order.status === "CANCELLED" ||
          order.status === "RTO_INITIATED" ||
          order.status === "RTO_DELIVERED_TO_SELLER"
        ? order.refundRequests.find((r) => r.status === "PENDING" || r.status === "APPROVED")
        : order.status === "RETURN_APPROVED" || order.status === "REFUND_INITIATED"
          ? order.refundRequests.find((r) => r.status === "APPROVED")
          : undefined;

  // Deliberately separate from refundRequest above — that lookup only
  // ever finds a PENDING/APPROVED row, so it goes back to undefined once
  // a return's refund is fully REFUNDED, even though the item might still
  // need a RapidShyp pickup scheduled. This instead finds the most
  // recent non-rejected, item-level (never a whole-order cancellation
  // refund) RefundRequest for this order, whatever its current status —
  // see admin-order-actions.tsx's returnPickupInfo doc comment.
  const pickupEligibleRefundRequest = order.refundRequests
    .filter((r) => r.orderItemId != null && r.status !== "PENDING" && r.status !== "REJECTED")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const returnPickupInfo = pickupEligibleRefundRequest
    ? {
        refundRequestId: pickupEligibleRefundRequest.id,
        scheduled: order.shipment?.returnRapidshypOrderId != null,
      }
    : null;

  // Only fetched when actually needed — powers the "Accept on behalf of
  // seller" panel (admin-order-actions.tsx), which only ever renders for a
  // CONFIRMED order with no pickup point yet (see acceptOrderAsAdmin's doc
  // comment in order-workflow.ts for why this can't just be the generic
  // manual status-override).
  const sellerPickupPoints =
    order.status === "CONFIRMED" && !order.pickupPointId
      ? await prisma.sellerPickupPoint.findMany({
          where: { sellerId: order.sellerId, isActive: true, approvalStatus: "APPROVED" },
          select: { id: true, name: true },
          orderBy: { isDefault: "desc" },
        })
      : [];

  // Real OrderStatus transitions, same source as before, plus (POS orders
  // only) synthetic entries for the payment-proof lifecycle — uploading
  // and admin verification aren't OrderStatus transitions at all (a
  // PosPaymentProofSubmission's own status lives independently), so they
  // don't exist in order.statusHistory and have to be woven in here by
  // timestamp to read as one continuous timeline the way the reference
  // design shows it.
  const statusTimeline: {
    id: string;
    status: string;
    label: string;
    createdAt: Date;
    note: string | null;
  }[] = order.statusHistory.map((entry) => ({
    id: entry.id,
    status: entry.status,
    label: ORDER_STATUS_LABEL[entry.status] ?? entry.status,
    createdAt: entry.createdAt,
    // Who/how moved it, folded in alongside any admin-entered free-text
    // note rather than dropped — was previously crammed into the label
    // itself ("Awaiting payment — DEALER (CUSTOMER)"), which read as noise
    // next to the reference design's plain "Order Placed (Website)" style.
    note: [entry.note, `${entry.actorRole} · ${entry.source}`].filter(Boolean).join(" — "),
  }));
  for (const posProof of liveProofs) {
    statusTimeline.push({
      id: `${posProof.id}-uploaded`,
      status: "PROOF_UPLOADED",
      label: `Payment Proof Uploaded (${formatCurrency(posProof.amount)})`,
      createdAt: posProof.uploadedAt as Date,
      note: null,
    });
    if (posProof.status === "PENDING") {
      statusTimeline.push({
        id: `${posProof.id}-pending`,
        status: "PROOF_PENDING",
        label: "POS Payment Verification Pending (Admin)",
        createdAt: posProof.uploadedAt as Date,
        note: null,
      });
    }
  }
  statusTimeline.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All orders
        </Link>
        <div className="flex items-center gap-4">
          {order.shipment?.labelUrl && (
            <a
              href={`/api/admin/orders/${order.id}/label`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold text-green-700 hover:underline"
            >
              Download shipping label
            </a>
          )}
          <a
            href={`/api/admin/orders/${order.id}/invoice`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-green-700 hover:underline"
          >
            Download Invoice
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-ink">{order.orderNumber}</h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isPos
                      ? "bg-purple-100 text-purple-700"
                      : isBa
                        ? "bg-blue-100 text-blue-700"
                        : "bg-green-100 text-green-700"
                  }`}
                >
                  {isPos || isBa ? <Store className="h-3 w-3" aria-hidden="true" /> : null}
                  {isPos ? "POS Order" : isBa ? "BA Order" : "Website Order"}
                </span>
              </div>
              <div className="mt-1.5 text-sm text-gray-600">
                Placed by:{" "}
                {isPos
                  ? `${order.placedByName} (POS)`
                  : isBa && baProfile
                    ? `${baProfile.firstName} ${baProfile.lastName} (BA ${baProfile.referralCode}, ${baProfile.contactNumber})`
                    : (getFullName(order.checkoutGroup.customer) ?? "—")}
              </div>
              <div className="text-xs text-gray-400">
                Placed on {formatDate(order.createdAt, true)}
                {!isPos && !isBa && " · Web"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">Current Status</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-base font-extrabold text-green-800">
                <Truck className="h-4 w-4" aria-hidden="true" />
                {ORDER_STATUS_LABEL[order.status] ?? order.status}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Updated on {formatDate(order.updatedAt, true)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-5">
            <StatCell label="Order Total" value={formatCurrency(netPayable)} />
            <StatCell
              label={isPos ? "Paid" : "Paid Online"}
              // Organic: strictly the online-paid portion, matching the
              // Payment Summary card below exactly — never blended with a
              // separately-collected COD/deferred amount (that's what
              // "To Collect on Delivery" already accounts for). POS
              // intentionally shows the full blended total instead: a POS
              // sale routinely mixes a verified online portion with cash
              // collected in person, and "Paid" (not "Paid Online") is
              // this order's real running total either way.
              value={formatCurrency(isPos ? amountPaid : paidOnlinePortion)}
              tone="success"
            />
            <StatCell
              label={isPos ? "Balance to Collect" : "To Collect on Delivery"}
              value={formatCurrency(outstanding)}
              tone={outstanding > 0.005 ? "warning" : undefined}
            />
            <StatCell
              label="Payment Type"
              value={PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
            />
            <StatCell label="Channel" value={isPos ? "POS" : isBa ? "BA" : "Website"} />
          </div>
        </Card>

        <DetailSection title="Customer & Delivery Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  Customer Details
                </h3>
                <CustomerOrderHistoryButton
                  customerId={order.checkoutGroup.customer.id}
                  label={getFullName(order.checkoutGroup.customer) ?? "Customer"}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-sm text-ink">
                <span className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                  {getFullName(order.checkoutGroup.customer) ?? "—"}
                </span>
                <span className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                  {order.checkoutGroup.customer.phone ?? "—"}
                </span>
                {order.checkoutGroup.customer.email && (
                  <span className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                    {order.checkoutGroup.customer.email}
                  </span>
                )}
              </div>
            </Card>
            {address && (
              <Card className="p-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  Delivery Address
                </h3>
                <div className="flex items-start gap-2 text-sm text-ink">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                  <span>
                    {address.fullName}, +{address.mobile}
                    <br />
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ""}, {address.cityTown}, {address.district},{" "}
                    {address.state} - {address.pincode}
                  </span>
                </div>
              </Card>
            )}
          </div>
        </DetailSection>

        <DetailSection title="Items">
          <TableShell>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Product</TableHeaderCell>
                  <TableHeaderCell align="right">Qty</TableHeaderCell>
                  <TableHeaderCell align="right">Unit price</TableHeaderCell>
                  <TableHeaderCell align="right">Total</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <OrderItemSummary
                        size="sm"
                        imageUrl={imageByItemId.get(item.id)}
                        name={item.productName}
                        variantLabel={item.variantLabel}
                        sku={item.sku}
                      />
                    </TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    <TableCell align="right">{formatCurrency(item.unitPrice.toString())}</TableCell>
                    <TableCell align="right" className="font-semibold">
                      {formatCurrency(item.subtotal.toString())}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold text-gray-600">
                    Merchandise Subtotal
                  </TableCell>
                  <TableCell align="right" className="font-bold">
                    {formatCurrency(order.subtotal.toString())}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableShell>
        </DetailSection>

        <PaymentSummary
          channel={isPos ? "POS" : "WEBSITE"}
          sellerOrderId={order.id}
          orderTotal={netPayable}
          amountPaid={amountPaid}
          outstanding={Math.max(0, outstanding)}
          paymentMethodLabel={PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
          onlinePayment={onlinePayment}
          posCheckoutGroupId={posCheckoutGroupId}
          liveProofs={liveProofs}
        />

        {order.shipment && (
          <DetailSection title="Shipment Details">
            <Card className="p-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                <StatCell
                  label="Provider"
                  value={order.shipment.provider === "MOCK" ? "Third Party Transport" : order.shipment.provider}
                />
                <StatCell label="AWB" value={order.shipment.awbNumber ?? "—"} />
                <StatCell label="Status" value={order.shipment.status} />
                {order.shipment.provider !== "MOCK" && (
                  <>
                    <StatCell label="Courier" value={order.shipment.courierName ?? "—"} />
                    <StatCell
                      label="Tracking Status"
                      value={
                        order.shipment.trackingStatusDesc
                          ? `${order.shipment.trackingStatusDesc} (${order.shipment.trackingStatusCode})`
                          : "—"
                      }
                    />
                    <StatCell
                      label="Last Synced"
                      value={order.shipment.lastSyncedAt ? formatDate(order.shipment.lastSyncedAt, true) : "—"}
                    />
                  </>
                )}
              </div>
            </Card>
            {order.shipment.statusHistory.length > 0 && (
              <Card className="p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  Tracking history
                </p>
                {/* Every distinct code the provider has reported — not just the
                    ones that also moved our own OrderStatus/ShipmentStatus (see
                    ShipmentStatusHistory.status's schema doc comment: it's null
                    for an informational-only code, e.g. an on-hold or RTO event
                    from RapidShyp). Falls back to the internal status label for
                    rows old enough to predate courierStatusCode/Desc, and for
                    every manual/mock-provider row, which never has one. */}
                <OrderStatusTimeline entries={buildTrackingTimeline(order.shipment.statusHistory)} />
              </Card>
            )}
          </DetailSection>
        )}

        <DetailSection title="Order Timeline">
          <Card className="p-4">
            <OrderStatusTimeline entries={statusTimeline} />
          </Card>
        </DetailSection>

        <DetailSection title="Admin Actions">
          <Card className="p-4">
            <AdminOrderActions
              sellerOrderId={order.id}
              orderNumber={order.orderNumber}
              status={order.status}
              hasShipment={!!order.shipment}
              shipmentProvider={order.shipment?.provider ?? null}
              isCancellationRequested={order.status === "CANCELLATION_REQUESTED"}
              paymentMethod={order.paymentMethod}
              outstanding={round2(outstanding)}
              sellerPickupPoints={sellerPickupPoints}
              deliveryMethod={order.deliveryMethod}
              refundRequest={
                refundRequest
                  ? {
                      id: refundRequest.id,
                      status: refundRequest.status as "PENDING" | "APPROVED",
                      reason: refundRequest.reason,
                      amount: refundRequest.amount.toString(),
                      refundMethod: refundRequest.refundMethod,
                      bankAccountHolderName: refundRequest.bankAccountHolderName,
                      bankAccountNumber: refundRequest.bankAccountNumber,
                      bankIfsc: refundRequest.bankIfsc,
                      imageUrls: refundRequest.imageUrls
                        .map((url) => resolveStorefrontAssetUrl(url))
                        .filter((url): url is string => url != null),
                      videoUrl: resolveStorefrontAssetUrl(refundRequest.videoUrl),
                      orderItemId: refundRequest.orderItemId,
                    }
                  : null
              }
              refundChoices={
                refundRequest?.status === "APPROVED"
                  ? refundChoicesFor({
                      isPos,
                      buyerChoice: refundRequest.orderItemId
                        ? refundRequest.refundMethod
                        : order.cancellationRefundMethod,
                      paymentMethod: order.paymentMethod,
                      hasGatewayPayment: order.paymentAllocations.some(
                        (a) => a.payment.razorpayPaymentId != null,
                      ),
                    })
                  : null
              }
              returnPickupInfo={returnPickupInfo}
              rapidShypShipment={
                order.shipment && order.shipment.provider !== "MOCK"
                  ? {
                      provider: order.shipment.provider as "RAPIDSHYP" | "DELHIVERY",
                      rapidshypOrderId: order.shipment.rapidshypOrderId,
                      awbNumber: order.shipment.awbNumber,
                      courierName: order.shipment.courierName,
                      labelUrl: order.shipment.labelUrl,
                      trackingStatusCode: order.shipment.trackingStatusCode,
                      trackingStatusDesc: order.shipment.trackingStatusDesc,
                      lastSyncedAt: order.shipment.lastSyncedAt,
                    }
                  : null
              }
            />
          </Card>
        </DetailSection>

        <DetailSection title="Detailed charge breakdown">
          <Card className="divide-y divide-border p-4">
            <KeyValue
              label="Merchandise subtotal"
              value={formatCurrency(order.subtotal.toString())}
            />
            <KeyValue
              label="Product discount"
              value={formatCurrency(order.discountAmount.toString())}
            />
            <KeyValue label="Tax" value={formatCurrency(order.taxAmount.toString())} />
            {order.charge && (
              <>
                <KeyValue
                  label={`Transportation cost (payer: ${
                    order.charge.transportationPayer === "CUSTOMER"
                      ? order.customerType === "DEALER"
                        ? "Dealer"
                        : "Customer"
                      : order.charge.transportationPayer
                  })`}
                  value={formatCurrency(order.charge.transportationCost.toString())}
                />
                <KeyValue
                  label={
                    <>
                      Collection charge (payer: {order.charge.collectionChargePayer}){" "}
                      <span className="text-xs text-gray-400">
                        (
                        {(order.charge.collectionChargeSnapshot as { formula?: string } | null)
                          ?.formula ?? "no snapshot recorded"}
                        )
                      </span>
                    </>
                  }
                  value={formatCurrency(order.charge.customerPayableDelivery.toString())}
                />
                {Number(order.charge.promotionalDiscountAmount) > 0 && (
                  <KeyValue
                    label={`Customer payment-method discount (${order.charge.promotionalDiscountPercent.toString()}%, payer: ${order.charge.promotionalDiscountPayer})`}
                    value={formatCurrency(order.charge.promotionalDiscountAmount.toString())}
                  />
                )}
                <KeyValue
                  label="Customer payable (net of promo discount)"
                  value={formatCurrency(order.charge.customerPayableTotal.toString())}
                  emphasis
                />
                <KeyValue
                  label="Seller-borne amount"
                  value={formatCurrency(order.charge.sellerBorneAmount.toString())}
                />
                <KeyValue
                  label="Kisan4U-borne amount"
                  value={formatCurrency(order.charge.kisan4uBorneAmount.toString())}
                />
                <KeyValue
                  label="Kisan4U collected amount"
                  value={formatCurrency(order.charge.kisan4uCollectedAmount.toString())}
                />
              </>
            )}
            <KeyValue
              label="Order total (gross, seller settlement basis)"
              value={formatCurrency(order.totalAmount.toString())}
              emphasis
            />
            <KeyValue
              label="Delivery / payment method"
              value={`${DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod} · ${PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}`}
            />
            {order.transportNote && (
              <KeyValue label="Transport note (dealer-provided)" value={order.transportNote} />
            )}
          </Card>
        </DetailSection>

        <DetailSection title="Payment detail">
          <TableShell>
            <Table id="payment-detail">
              <TableHead>
                <tr>
                  <TableHeaderCell>Payment</TableHeaderCell>
                  <TableHeaderCell align="right">Allocated</TableHeaderCell>
                  <TableHeaderCell align="right">Wallet-funded</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Collected / Order total</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {order.paymentAllocations.map((allocation) => {
                  // allocation.payment.amountPaid/totalAmount are
                  // deliberately scoped to only the upfront charge
                  // attempted at checkout (for ONLINE_PARTIAL that's just
                  // the advance — see checkout.ts's chargeAmount and
                  // payment-collection.ts's own doc comment). Showing them
                  // directly as "Paid / Total" read as the order's real
                  // total even after a COD/deferred remainder was fully
                  // collected on delivery (e.g. ₹2,923 / ₹2,923 — looks
                  // fully paid, but the real order total was ₹14,615).
                  // Blends in remainingCollectedAmount and uses this
                  // order's real netPayable, matching the "Amount
                  // paid"/"Outstanding" figures above exactly.
                  const collected = round2(
                    Number(allocation.amount) *
                      (Number(allocation.payment.amountPaid) /
                        Number(allocation.payment.totalAmount || 1)) +
                      Number(allocation.remainingCollectedAmount),
                  );
                  return (
                    <TableRow key={allocation.id}>
                      <TableCell className="font-mono text-xs">
                        {allocation.payment.internalReference}
                      </TableCell>
                      <TableCell align="right">
                        {formatCurrency(allocation.amount.toString())}
                      </TableCell>
                      <TableCell align="right">
                        {Number(allocation.walletAmountApplied) > 0
                          ? `${formatCurrency(allocation.walletAmountApplied.toString())}${allocation.walletRefunded ? " (refunded)" : ""}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={allocation.payment.status}
                          label={PAYMENT_STATUS_LABEL[allocation.payment.status]}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {formatCurrency(collected.toFixed(2))} /{" "}
                        {formatCurrency(netPayable.toFixed(2))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableShell>
          <Card className="p-4">
            <KeyValue label="Amount paid" value={formatCurrency(amountPaid.toFixed(2))} />
            <KeyValue label="Outstanding" value={formatCurrency(outstanding.toFixed(2))} emphasis />
          </Card>
        </DetailSection>
      </div>
    </PageContainer>
  );
}
