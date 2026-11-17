import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Printer, Store, Truck } from "lucide-react";
import {
  getSellerOrderForSeller,
  getSelectablePickupPoints,
  resolveOrderItemImageUrls,
  netPayableForOrder,
  paidSoFarFor,
} from "@kisan4u/orders";
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
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { buildTrackingTimeline } from "@/lib/tracking-timeline";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  DELIVERY_METHOD_LABEL,
  REFUND_REQUEST_STATUS_LABEL,
} from "@/lib/order-status-labels";
import { OrderActions } from "./order-actions";

const TAG_PRINTABLE_STATUSES = [
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
];

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

// Mirrors the admin order detail page's StatCell so the seller page reads
// as the same design.
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

export default async function SellerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;
  const order = await getSellerOrderForSeller(sellerProfileId, id);
  if (!order) notFound();

  const pickupPoints = await getSelectablePickupPoints(sellerProfileId);
  const address = order.checkoutGroup.addressSnapshot;
  const paidTotal = order.paymentAllocations.reduce(
    (total, allocation) => total + Number(allocation.amount),
    0,
  );
  const walletApplied = order.paymentAllocations.reduce(
    (total, allocation) => total + Number(allocation.walletAmountApplied),
    0,
  );
  const paymentSatisfied = order.paymentMethod === "COD" || order.status !== "PENDING_PAYMENT";
  const netPayable = netPayableForOrder(order);
  const discountAmount = order.charge ? Number(order.charge.promotionalDiscountAmount) : 0;
  const collectedSoFar = paidSoFarFor(order.paymentAllocations);
  const codBalanceDue = Math.max(0, netPayable - collectedSoFar);
  const imageByItemId = new Map(
    [...(await resolveOrderItemImageUrls(order.items.map((item) => ({ ...item, key: item.id }))))].map(
      ([key, url]) => [key, resolveStorefrontAssetUrl(url)],
    ),
  );

  const statusTimeline = order.statusHistory.map((entry) => ({
    id: entry.id,
    status: entry.status,
    label: `${ORDER_STATUS_LABEL[entry.status] ?? entry.status}${entry.note ? ` — ${entry.note}` : ""}`,
    createdAt: entry.createdAt,
  }));

  // Every distinct code RapidShyp has ever reported for this shipment —
  // not just the ones that also moved our own OrderStatus (see
  // ShipmentStatusHistory.status's schema doc comment: it's null for a
  // code like an on-hold or RTO event that's informational-only). Falls
  // back to the internal status label only for the rows old enough to
  // predate courierStatusCode/Desc being recorded.
  const shipmentTrackingTimeline = buildTrackingTimeline(order.shipment?.statusHistory ?? []);

  // A Business Associate's approved order goes through the same placedBy
  // mechanism as a POS order (and sets placedByName too), so tell them apart
  // by what kind of profile the placing user actually has — same rule as the
  // admin order page.
  const placedByUser = order.checkoutGroup.placedByUser;
  const baProfile = order.placedByUserId != null ? (placedByUser?.baProfile ?? null) : null;
  const isBa = baProfile != null;
  const isPos = order.placedByUserId != null && placedByUser?.staffProfile != null;

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          href="/seller/orders"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All orders
        </Link>
        <div className="flex items-center gap-4">
          {order.shipment?.awbNumber && order.shipment.provider !== "MOCK" && (
            <a
              href={`/api/seller/orders/${order.id}/label`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold text-green-700 hover:underline"
            >
              Download shipping label
            </a>
          )}
          <a
            href={`/api/seller/orders/${order.id}/invoice`}
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
              {isBa && baProfile && (
                <div className="mt-1.5 text-sm text-gray-600">
                  Placed by: {baProfile.firstName} {baProfile.lastName} (BA {baProfile.referralCode})
                </div>
              )}
              <div className="mt-1.5 text-sm text-gray-600">
                {address
                  ? `${address.cityTown}, ${address.district}, ${address.state} - ${address.pincode}`
                  : "—"}
              </div>
              <div className="text-xs text-gray-400">Placed on {formatDate(order.createdAt, true)}</div>
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
            <StatCell label="Order Total" value={formatCurrency(order.totalAmount.toString())} />
            <StatCell
              label="Collected so far"
              value={formatCurrency(collectedSoFar.toFixed(2))}
              tone="success"
            />
            <StatCell
              label="Balance due (COD)"
              value={codBalanceDue > 0 ? formatCurrency(codBalanceDue.toFixed(2)) : "—"}
              tone={codBalanceDue > 0.005 ? "warning" : undefined}
            />
            <StatCell
              label="Payment Type"
              value={PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
            />
            <StatCell
              label="Delivery"
              value={DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
            />
          </div>
        </Card>

        {address && (
          <DetailSection title="Delivery Address">
            <Card className="p-4">
              <div className="flex items-start gap-2 text-sm text-ink">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span>
                  {/* address.mobile is already redacted ("xxxx") by getSellerOrderForSeller. */}
                  {address.fullName}, {address.mobile}
                  <br />
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}, {address.cityTown}, {address.district},{" "}
                  {address.state} - {address.pincode}
                </span>
              </div>
            </Card>
          </DetailSection>
        )}

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
                      {item.licenseRequiredSnapshot && (
                        <span className="ml-[54px] block text-xs font-semibold text-warning">
                          Licensed category
                        </span>
                      )}
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

        <DetailSection title="Payment">
          <Card className="divide-y divide-border p-4">
            <KeyValue
              label="Method"
              value={PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
            />
            <KeyValue
              label="Delivery method"
              value={DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
            />
            <KeyValue
              label="Payment requirement satisfied"
              value={paymentSatisfied ? "Yes" : "No, awaiting payment"}
            />
            <KeyValue
              label="Order total"
              value={formatCurrency(order.totalAmount.toString())}
              emphasis
            />
            {discountAmount > 0 && (
              <KeyValue
                label="Customer discount (Kisan4U-borne — doesn't affect your settlement)"
                value={`−${formatCurrency(discountAmount.toFixed(2))}`}
              />
            )}
            <KeyValue
              label="Customer pays"
              value={formatCurrency(netPayable.toFixed(2))}
              emphasis
            />
            <KeyValue label="Collected so far" value={formatCurrency(collectedSoFar.toFixed(2))} />
            <KeyValue
              label="Balance due on delivery (COD)"
              value={codBalanceDue > 0 ? formatCurrency(codBalanceDue.toFixed(2)) : "Fully collected"}
            />
            <KeyValue label="Allocated" value={formatCurrency(paidTotal.toFixed(2))} />
            {walletApplied > 0 && (
              <KeyValue
                label="Kisan4U Wallet applied"
                value={formatCurrency(walletApplied.toFixed(2))}
              />
            )}
            {order.transportNote && (
              <KeyValue label="Transport note (dealer-provided)" value={order.transportNote} />
            )}
          </Card>
        </DetailSection>

        {order.charge && (
          <DetailSection title="Your charges">
            <Card className="divide-y divide-border p-4">
              <KeyValue label="Shipment weight" value={`${order.charge.shipmentWeightGrams} g`} />
              <KeyValue
                label={`Transportation cost (${order.charge.transportationPayer === "SELLER" ? "borne by you" : "paid by customer"})`}
                value={formatCurrency(order.charge.transportationCost.toString())}
              />
              <KeyValue
                label="Collection charge (borne by you)"
                value={formatCurrency(order.charge.collectionCharge.toString())}
              />
            </Card>
          </DetailSection>
        )}

        {order.shipment && (
          <DetailSection title="Shipment">
            <Card className="p-4">
              <KeyValue label="AWB" value={order.shipment.awbNumber ?? "—"} />
              <KeyValue label="Status" value={order.shipment.status} />
              {order.shipment.provider !== "MOCK" && (
                <>
                  <KeyValue
                    label="Courier"
                    value={order.shipment.courierName ?? "Not yet assigned"}
                  />
                  <KeyValue
                    label="Latest tracking update"
                    value={order.shipment.trackingStatusDesc ?? "No update yet"}
                  />
                </>
              )}
            </Card>
            {order.shipment.provider !== "MOCK" && order.shipment.statusHistory.length > 0 && (
              <Card className="p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  Tracking history
                </p>
                <OrderStatusTimeline entries={shipmentTrackingTimeline} />
              </Card>
            )}
          </DetailSection>
        )}

        {order.refundRequests.length > 0 && (
          <DetailSection title="Return requests">
            <div className="flex flex-col gap-3">
              {order.refundRequests.map((rr) => (
                <Card key={rr.id} className="p-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <StatusBadge status={rr.status} label={REFUND_REQUEST_STATUS_LABEL[rr.status] ?? rr.status} />
                    <span className="text-xs text-gray-500">{formatCurrency(rr.amount.toString())}</span>
                  </div>
                  <p className="text-sm text-ink">{rr.reason}</p>
                  {(rr.imageUrls.length > 0 || rr.videoUrl) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rr.imageUrls.map((url) => {
                        const resolved = resolveStorefrontAssetUrl(url);
                        return resolved ? (
                          <a
                            key={url}
                            href={resolved}
                            target="_blank"
                            rel="noreferrer"
                            className="block h-16 w-16 overflow-hidden rounded-md border border-border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- customer-uploaded return-evidence photo, not a static Next asset */}
                            <img src={resolved} alt="Return evidence" className="h-full w-full object-cover" />
                          </a>
                        ) : null;
                      })}
                      {rr.videoUrl && resolveStorefrontAssetUrl(rr.videoUrl) && (
                        <a
                          href={resolveStorefrontAssetUrl(rr.videoUrl)!}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-surface-alt text-[10px] font-semibold text-gray-600"
                        >
                          ▶ Video
                        </a>
                      )}
                    </div>
                  )}
                  {rr.reviewNote && (
                    <p className="mt-2 text-xs text-gray-600">Admin note: {rr.reviewNote}</p>
                  )}
                </Card>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Return decisions and refunds are handled by Kisan4U admin — this is view-only.
            </p>
          </DetailSection>
        )}

        <DetailSection title="Order Timeline">
          <Card className="p-4">
            <OrderStatusTimeline entries={statusTimeline} />
          </Card>
        </DetailSection>

        <DetailSection title="Actions">
          <Card className="p-4">
            <OrderActions
              sellerOrderId={order.id}
              orderNumber={order.orderNumber}
              paymentMethod={order.paymentMethod}
              status={order.status}
              pickupPoints={pickupPoints}
              deliveryMethod={order.deliveryMethod}
              shipmentProvider={order.shipment?.provider ?? null}
            />
          </Card>
        </DetailSection>

        {TAG_PRINTABLE_STATUSES.includes(order.status) && (
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href={`/seller/orders/${order.id}/tag`}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:underline"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print Kisan4U order tag
            </Link>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
