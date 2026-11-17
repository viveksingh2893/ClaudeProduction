import { prisma } from "@kisan4u/db";
import { redactAddressContact } from "./contact-redaction";

export type OrderTagData = {
  sellerOrderNumber: string;
  checkoutGroupNumber: string;
  sellerName: string;
  pickupPointName: string | null;
  customerName: string;
  deliveryAddressLines: string[];
  customerMobile: string;
  deliveryMethod: string;
  paymentMethod: string;
  codAmount: number | null;
  packageCount: number | null;
  productSummary: string;
  totalWeightGrams: number;
  /** Safe, public, non-secret order reference for the QR/barcode — never a raw database id or token (Phase 4 spec §P). */
  qrPayload: string;
};

export type OrderTagResult = { ok: true; tag: OrderTagData } | { ok: false; error: string };

/** Ownership-scoped: a seller must not print another seller's order tag (§O/§Z). */
export async function getOrderTagData(
  sellerId: string,
  sellerOrderId: string,
): Promise<OrderTagResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, sellerId },
    include: {
      items: true,
      shipment: true,
      pickupPoint: true,
      seller: { select: { shopName: true } },
      checkoutGroup: { include: { addressSnapshot: true } },
      paymentAllocations: true,
    },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const address = order.checkoutGroup.addressSnapshot;
  if (!address) return { ok: false, error: "Delivery address is missing for this order." };

  const totalWeightGrams = order.items.reduce((total, item) => total + item.totalWeightGrams, 0);
  const codAllocation = order.paymentMethod === "COD" ? order.paymentAllocations[0] : undefined;

  const deliveryAddressLines = [
    address.line1,
    address.line2,
    address.landmark,
    `${address.cityTown}, ${address.district}`,
    `${address.state} - ${address.pincode}`,
  ].filter((v): v is string => Boolean(v && v.trim().length > 0));

  return {
    ok: true,
    tag: {
      sellerOrderNumber: order.orderNumber,
      checkoutGroupNumber: order.checkoutGroup.groupNumber,
      sellerName: order.seller.shopName,
      pickupPointName: order.pickupPoint?.name ?? null,
      customerName: address.fullName,
      deliveryAddressLines,
      // Sellers never see a buyer's phone number — see contact-redaction.ts.
      customerMobile: redactAddressContact(address).mobile,
      deliveryMethod: order.deliveryMethod,
      paymentMethod: order.paymentMethod,
      // COD to collect = the allocation's full share minus whatever the
      // buyer already paid from their wallet at checkout.
      codAmount: codAllocation
        ? Math.max(0, Number(codAllocation.amount) - Number(codAllocation.walletAmountApplied))
        : null,
      packageCount: order.shipment?.packageCount ?? null,
      productSummary: order.items
        .map(
          (item) =>
            `${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ""} x${item.quantity}`,
        )
        .join(", "),
      totalWeightGrams,
      qrPayload: order.orderNumber,
    },
  };
}
