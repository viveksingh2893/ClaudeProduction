import { netPayableForOrder, paidSoFarFor, type listSellerOrdersForSellerPaginated } from "@kisan4u/orders";
import type { SellerOrderRow } from "@/app/seller/orders/seller-orders-table";

type SellerOrder = Awaited<ReturnType<typeof listSellerOrdersForSellerPaginated>>["rows"][number];

/**
 * Shared between the full seller orders table (/seller/orders) and the
 * seller's "Returns" tab (/seller/returns) — both show the exact same
 * order list shape, just a differently-filtered query. Same reuse
 * pattern buildAdminOrderRow already established on the admin side.
 * SellerOrder carries a Decimal (totalAmount) that isn't
 * plain-serializable across the Server -> Client boundary, so this trims
 * to exactly what SellerOrdersTable renders.
 */
export function buildSellerOrderRow(
  order: SellerOrder,
  imageByItemId: Map<string, string | null>,
): SellerOrderRow {
  const netPayable = netPayableForOrder(order);
  const discountAmount = order.charge ? Number(order.charge.promotionalDiscountAmount) : 0;
  const paidSoFar = paidSoFarFor(order.paymentAllocations);
  const balanceRemaining = Math.max(0, netPayable - paidSoFar);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    address: order.checkoutGroup.addressSnapshot
      ? {
          cityTown: order.checkoutGroup.addressSnapshot.cityTown,
          state: order.checkoutGroup.addressSnapshot.state,
          pincode: order.checkoutGroup.addressSnapshot.pincode,
        }
      : null,
    deliveryMethod: order.deliveryMethod,
    paymentMethod: order.paymentMethod,
    status: order.status,
    shipmentProvider: order.shipment?.provider ?? null,
    // Gross — this is the seller's own settlement basis (a Kisan4u-borne
    // discount never reduces it, see checkout-draft.ts's customerTaxAmount
    // doc), so it deliberately stays what it's always been rather than
    // switching to the net customer-payable figure.
    totalAmount: order.totalAmount.toString(),
    discountAmount: discountAmount.toFixed(2),
    paidSoFar: paidSoFar.toFixed(2),
    balanceRemaining: balanceRemaining.toFixed(2),
    firstItem: order.items[0]
      ? {
          name: order.items[0].productName,
          imageUrl: imageByItemId.get(order.items[0].id) ?? null,
        }
      : null,
    itemCount: order.items.length,
    hasLabel: !!order.shipment?.awbNumber && order.shipment.provider !== "MOCK",
  };
}
