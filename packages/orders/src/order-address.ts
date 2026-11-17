import { prisma, type UserRole } from "@kisan4u/db";
import type { OrderAddressUpdateInput } from "@kisan4u/validators";
import { writeAuditLog } from "./audit";

export type OrderAddressView = {
  sellerOrderId: string;
  checkoutGroupId: string;
  /** How many other SellerOrders share this checkout group's address — OrderAddressSnapshot is 1:1 with CheckoutGroup, so an edit here changes the delivery address for all of them, not just this one order. */
  siblingOrderCount: number;
  fullName: string;
  mobile: string;
  altMobile: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  stateId: string | null;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
};

export async function getOrderAddressForAdmin(sellerOrderId: string): Promise<OrderAddressView | null> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    select: {
      id: true,
      checkoutGroupId: true,
      checkoutGroup: {
        select: {
          addressSnapshot: true,
          _count: { select: { sellerOrders: true } },
        },
      },
    },
  });
  if (!order?.checkoutGroup.addressSnapshot) return null;
  const snap = order.checkoutGroup.addressSnapshot;
  return {
    sellerOrderId: order.id,
    checkoutGroupId: order.checkoutGroupId,
    siblingOrderCount: order.checkoutGroup._count.sellerOrders - 1,
    fullName: snap.fullName,
    mobile: snap.mobile,
    altMobile: snap.altMobile,
    line1: snap.line1,
    line2: snap.line2,
    landmark: snap.landmark,
    cityTown: snap.cityTown,
    district: snap.district,
    state: snap.state,
    stateId: snap.stateId,
    pincode: snap.pincode,
    addressType: snap.addressType,
  };
}

export type UpdateOrderAddressResult = { ok: true } | { ok: false; error: string };

/**
 * Corrects a placed order's delivery address (OrderAddressSnapshot) —
 * normally treated as an immutable per-checkout copy (see the model's doc
 * comment: past orders must not silently change when a customer edits
 * their saved address later), but the scheduling team needs an explicit,
 * audited way to fix a wrong address caught while confirming/dispatching.
 * Since the snapshot is 1:1 with CheckoutGroup, this updates the delivery
 * address for every SellerOrder in that checkout, not just the one the
 * admin opened the wizard from.
 */
export async function updateOrderAddress(
  actor: { id: string; role: UserRole },
  input: OrderAddressUpdateInput,
): Promise<UpdateOrderAddressResult> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: input.sellerOrderId },
    select: { checkoutGroupId: true, checkoutGroup: { select: { addressSnapshot: { select: { id: true } } } } },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.checkoutGroup.addressSnapshot) return { ok: false, error: "This order has no delivery address on file." };

  const before = await prisma.orderAddressSnapshot.findUnique({
    where: { id: order.checkoutGroup.addressSnapshot.id },
    select: {
      fullName: true,
      mobile: true,
      altMobile: true,
      line1: true,
      line2: true,
      landmark: true,
      cityTown: true,
      district: true,
      state: true,
      stateId: true,
      pincode: true,
      addressType: true,
    },
  });

  await prisma.orderAddressSnapshot.update({
    where: { id: order.checkoutGroup.addressSnapshot.id },
    data: {
      fullName: input.fullName,
      mobile: input.mobile,
      altMobile: input.altMobile ?? null,
      line1: input.line1,
      line2: input.line2 ?? null,
      landmark: input.landmark ?? null,
      cityTown: input.cityTown,
      district: input.district,
      state: input.state,
      stateId: input.stateId ?? null,
      pincode: input.pincode,
      addressType: input.addressType,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "ORDER_ADDRESS_CORRECTED",
    entityType: "CheckoutGroup",
    entityId: order.checkoutGroupId,
    metadata: { sellerOrderId: input.sellerOrderId, before, after: input },
  });

  return { ok: true };
}
