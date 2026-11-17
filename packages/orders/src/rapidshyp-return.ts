import { prisma, Prisma, type UserRole } from "@kisan4u/db";
import { rapidshypCreateReturnOrder } from "@kisan4u/providers";
import type { SendReturnToRapidShypInput } from "@kisan4u/validators";
import { writeAuditLog } from "./audit";
import { notifyBuyer } from "./notifications";
import { RAPIDSHYP_STORE_NAME, metresToCm } from "./rapidshyp-shipping";
import { estimateReturnPackageForItem } from "./return-package";
import { ensureRapidShypPickupLocation } from "./courier-pickup-sync";

export type SendReturnToRapidShypResult = { ok: true } | { ok: false; error: string };

/**
 * Arranges reverse pickup for a post-delivery return whose ORIGINAL
 * shipment actually went via RapidShyp — admin-only, mirroring every
 * other refund-decision action in this codebase. A return dispatched
 * through mock/manual logistics has no equivalent: per the owner's own
 * scope call, that stays entirely manual, unchanged.
 *
 * Only ever applies to the per-item return flow (RefundRequest.orderItemId
 * set) — a whole-order cancellation refund (orderItemId null,
 * cancellation.ts) never reaches here, since cancellation is blocked once
 * an order is actually picked up (status-transitions.ts's TRANSITIONS map
 * has no CANCELLATION_REQUESTED rule past PICKUP_SCHEDULED), so there's
 * never a delivered/in-the-customer's-hands package to reverse-pick-up
 * for a cancelled order in the first place.
 *
 * Direction is reversed from the forward shipment: RapidShyp picks up
 * FROM the customer's own delivery address and delivers BACK to the
 * order's pickup point's RapidShyp pickup location (registered on demand) —
 * see rapidshyp.ts's rapidshypCreateReturnOrder doc comment for why the
 * full deliveryAddress object is never sent, just that name.
 */
export async function sendReturnToRapidShyp(
  actor: { id: string; role: UserRole },
  input: SendReturnToRapidShypInput,
): Promise<SendReturnToRapidShypResult> {
  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: input.refundRequestId },
    include: {
      orderItem: true,
      sellerOrder: {
        include: {
          shipment: true,
          pickupPoint: true,
          checkoutGroup: { include: { addressSnapshot: true } },
        },
      },
    },
  });
  if (!refundRequest) return { ok: false, error: "Return request not found." };
  if (!refundRequest.orderItem) {
    return { ok: false, error: "This refund covers the whole order, not a single item — reverse pickup doesn't apply." };
  }
  if (refundRequest.status !== "APPROVED" && refundRequest.status !== "REFUNDED") {
    return { ok: false, error: "This return must be approved before scheduling a pickup." };
  }
  const order = refundRequest.sellerOrder;
  if (!order.shipment) return { ok: false, error: "This order has no shipment on file." };
  if (order.shipment.provider !== "RAPIDSHYP") {
    return {
      ok: false,
      error: "This order wasn't shipped via RapidShyp — arrange its return pickup manually instead.",
    };
  }
  if (order.shipment.returnRapidshypOrderId) {
    return { ok: false, error: "A return pickup has already been scheduled for this order." };
  }
  if (!order.pickupPoint) {
    return { ok: false, error: "This order has no pickup point to return the parcel to." };
  }
  const returnLocation = await ensureRapidShypPickupLocation(order.pickupPoint);
  if (!returnLocation.ok) {
    return {
      ok: false,
      error: `RapidShyp: could not register the seller's pickup point for the return (${returnLocation.error}).`,
    };
  }
  const address = order.checkoutGroup.addressSnapshot;
  if (!address) return { ok: false, error: "This order has no delivery address on file — can't schedule pickup." };

  const item = refundRequest.orderItem;
  const variant = item.variantId
    ? await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        select: { length: true, breadth: true, height: true },
      })
    : null;

  // Auto-booked on return approval with no dims form — estimate from the
  // item; the manual retry form's exact figures (when given) win.
  const pkg = await estimateReturnPackageForItem(item.id, {
    lengthCm: input.packageLengthCm,
    breadthCm: input.packageBreadthCm,
    heightCm: input.packageHeightCm,
    weightGrams: input.packageWeightGrams,
  });

  const [firstName, ...rest] = address.fullName.trim().split(/\s+/);
  const lastName = rest.join(" ");
  // address.mobile is always stored as "+91XXXXXXXXXX" (see
  // packages/validators/src/phone.ts's normalizeIndianPhone) — confirmed
  // live that RapidShyp's create_return rejects that with "Invalid phone
  // number format," unlike create_order's forward shippingAddress.phone
  // field, which accepts it unchanged. Their return API is the stricter
  // one here: bare 10-digit, no country-code prefix.
  const pickupPhone = address.mobile.replace(/^\+91/, "");

  const created = await rapidshypCreateReturnOrder({
    orderId: `${order.orderNumber}-RETURN`,
    orderDate: new Date().toISOString().slice(0, 10),
    pickupLocation: {
      pickupCustomerName: firstName || address.fullName,
      pickupCustomerLastName: lastName || undefined,
      pickupPhone,
      pickupAddress: address.line1,
      pickupAddress2: address.line2 ?? undefined,
      pickupPincode: address.pincode,
    },
    storeName: RAPIDSHYP_STORE_NAME,
    deliveryAddressName: returnLocation.name,
    orderItems: [
      {
        itemName: item.productName,
        sku: item.sku,
        units: item.quantity,
        // Gross line value spread evenly per unit — a return isn't
        // collecting money (no COD/discount-scaling concerns the way
        // forward dispatch has, see sendSellerOrderToRapidShyp's own
        // discountScaleRatio doc comment), so the item's own face-value
        // gross figures are sent as-is.
        unitPrice: item.quantity > 0 ? Number(item.subtotal) / item.quantity : Number(item.unitPrice),
        tax: item.quantity > 0 ? Number(item.taxAmount) / item.quantity : 0,
        productWeight: item.unitWeightGrams,
        productLength: metresToCm(variant?.length),
        productBreadth: metresToCm(variant?.breadth),
        productHeight: metresToCm(variant?.height),
      },
    ],
    packageDetails: {
      packageLength: pkg.lengthCm,
      packageBreadth: pkg.breadthCm,
      packageHeight: pkg.heightCm,
      packageWeight: pkg.weightGrams,
    },
  });
  if (!created.ok) return { ok: false, error: `RapidShyp: ${created.error}` };

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: order.shipment!.id },
      data: {
        returnRapidshypOrderId: created.data.rapidshypOrderId,
        returnShipmentId: created.data.shipmentId,
        returnRequestedAt: new Date(),
      },
    });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: order.shipment!.id,
        status: null,
        courierStatusDesc: "Return pickup scheduled with RapidShyp",
        rawProviderResponse: created.raw as Prisma.InputJsonValue,
      },
    });
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "RAPIDSHYP_RETURN_SCHEDULED",
    entityType: "SellerOrder",
    entityId: order.id,
    metadata: { rapidshypOrderId: created.data.rapidshypOrderId, refundRequestId: refundRequest.id },
  });
  await notifyBuyer({
    customerId: order.customerId,
    title: "Return pickup scheduled",
    body: `A courier will pick up your return for order ${order.orderNumber} soon.`,
  });

  return { ok: true };
}
