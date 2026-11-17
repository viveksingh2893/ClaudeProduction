import { prisma } from "@kisan4u/db";
import { round2 } from "./money";
import { netPayableForOrder, paidSoFarFor } from "./payment-collection";

/**
 * What the seller's own shipping label carries. Sellers never see a buyer's
 * phone number (see contact-redaction.ts), and the courier's own label PDF —
 * which always prints the consignee's number — can't be edited after the
 * fact, so a seller downloads THIS label instead: Kisan4U-generated, with the
 * courier AWB as a barcode, and deliberately no phone field at all. Admin
 * still gets the courier's original label (rapidshyp-label.ts).
 */
export type SellerLabelData = {
  orderNumber: string;
  awbNumber: string;
  /** Courier company as reported by the provider ("Delhivery", "Xpressbees", …); null for a third-party-transport shipment or before assignment. */
  courierName: string | null;
  shipTo: { fullName: string; addressLines: string[]; cityStateLine: string; pincode: string };
  shipFrom: { name: string; addressLines: string[] };
  /** "COD" when the courier still has money to collect, else "PREPAID". */
  paymentMode: "COD" | "PREPAID";
  /** What the courier collects on delivery — 0 for a prepaid order. */
  codAmount: number;
  totalWeightGrams: number;
  packageCount: number | null;
  productSummary: string;
};

export type SellerLabelResult = { ok: true; label: SellerLabelData } | { ok: false; error: string };

/** Ownership-scoped: a seller can only ever build a label for their own order. */
export async function getSellerLabelData(
  sellerId: string,
  sellerOrderId: string,
): Promise<SellerLabelResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, sellerId },
    include: {
      items: true,
      charge: true,
      shipment: { select: { provider: true, awbNumber: true, courierName: true, packageCount: true } },
      pickupPoint: true,
      seller: { select: { shopName: true } },
      checkoutGroup: { include: { addressSnapshot: true } },
      paymentAllocations: { include: { payment: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  // A third-party-transport (MOCK) shipment has no real courier AWB — it
  // never had a downloadable label, and the tag page covers it.
  if (!order.shipment?.awbNumber || order.shipment.provider === "MOCK") {
    return { ok: false, error: "No shipping label is available for this shipment yet." };
  }
  const address = order.checkoutGroup.addressSnapshot;
  if (!address) return { ok: false, error: "Delivery address is missing for this order." };

  // COD and the deferred remainder of a partial-prepaid order are both
  // collected in cash on delivery; the buyer's wallet share and any online
  // advance are already inside paidSoFarFor, so this is exactly what the
  // courier has left to collect.
  const collectsOnDelivery = order.paymentMethod === "COD" || order.paymentMethod === "ONLINE_PARTIAL";
  const codAmount = collectsOnDelivery
    ? round2(Math.max(0, netPayableForOrder(order) - paidSoFarFor(order.paymentAllocations)))
    : 0;

  const pickup = order.pickupPoint;
  return {
    ok: true,
    label: {
      orderNumber: order.orderNumber,
      awbNumber: order.shipment.awbNumber,
      courierName: order.shipment.courierName,
      shipTo: {
        fullName: address.fullName,
        addressLines: [address.line1, address.line2, address.landmark].filter(
          (v): v is string => Boolean(v && v.trim().length > 0),
        ),
        cityStateLine: `${address.cityTown}, ${address.district}, ${address.state}`,
        pincode: address.pincode,
      },
      shipFrom: {
        name: pickup?.name ?? order.seller.shopName,
        addressLines: pickup
          ? [pickup.line1, `${pickup.city}, ${pickup.district}`, `${pickup.state} - ${pickup.pincode}`].filter(
              (v) => v.trim().length > 0,
            )
          : [],
      },
      paymentMode: codAmount > 0 ? "COD" : "PREPAID",
      codAmount,
      totalWeightGrams: order.items.reduce((total, item) => total + item.totalWeightGrams, 0),
      packageCount: order.shipment.packageCount ?? null,
      productSummary: order.items
        .map(
          (item) =>
            `${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ""} x${item.quantity}`,
        )
        .join(", "),
    },
  };
}
