/**
 * BA "order on behalf of a referred customer" — the proposed-order flow.
 *
 * A fully- or bank-pending-approved BA, on their own account, builds a COD
 * order for one of THEIR referred CUSTOMERs (never a dealer). Stock is
 * reserved immediately. The referee gets an in-app + push notification and
 * a dedicated screen showing the full order (images, draft invoice) and
 * chooses APPROVE / REJECT / CUSTOMIZE:
 *
 *   APPROVE   -> the reservation is released and the exact lines are run
 *               through the normal checkout() as a COD order placed-by the
 *               BA; on success it becomes a real order and the BA earns.
 *   REJECT    -> reservation released, nothing ordered.
 *   CUSTOMIZE -> reservation released, the lines are pushed into the
 *               referee's own cart so they can edit + pay themselves.
 *
 * COD-only and customer-only are enforced here server-side. If COD is not
 * available for the referee's pincode the referee still sees a "choose
 * payment" path at approval time (they pay online themselves) — handled by
 * the normal checkout the approval routes through.
 */

import { prisma, type UserRole, type Prisma } from "@kisan4u/db";
import type { ProposedOrderCreateInput } from "@kisan4u/validators";
import { recordStockChange } from "@kisan4u/catalog";
import { validateCartLine } from "../line-validation";
import { notifyUser } from "../notifications";
import { round2 } from "../money";
import { checkout } from "../checkout";
import { isBaProgramEnabled } from "./settings";

type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

const ACTIVE_BA = ["APPROVED", "BANK_SUBMITTED"];

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createProposedOrder(
  baUserId: string,
  input: ProposedOrderCreateInput,
): Promise<Result<{ proposedOrderId: string }>> {
  if (!(await isBaProgramEnabled())) return { ok: false, error: "The Business Associate program is not active." };

  const baUser = await prisma.user.findUnique({
    where: { id: baUserId },
    select: { id: true, role: true, baProfile: { select: { id: true, status: true } } },
  });
  const ba = baUser?.baProfile;
  if (!ba || !ACTIVE_BA.includes(ba.status)) {
    return { ok: false, error: "Only an approved Business Associate can place orders on behalf of a customer." };
  }

  const referee = await prisma.user.findUnique({
    where: { id: input.refereeUserId },
    select: { id: true, role: true, referredByBaId: true, isActive: true, firstName: true, lastName: true, phone: true },
  });
  if (!referee || !referee.isActive) return { ok: false, error: "Customer not found." };
  if (referee.referredByBaId !== ba.id) {
    return { ok: false, error: "You can only place orders for customers you referred." };
  }
  if (referee.role !== "CUSTOMER") {
    return { ok: false, error: "Orders on behalf are only available for customer accounts, not dealers." };
  }

  // Resolve the delivery address (saved or typed) into a snapshot.
  let addressSnapshot: Record<string, unknown>;
  let savedFromInput: ProposedOrderCreateInput["address"] | null = null;
  if (input.savedAddressId) {
    const addr = await prisma.customerAddress.findFirst({
      where: { id: input.savedAddressId, userId: referee.id },
    });
    if (!addr) return { ok: false, error: "That saved address does not belong to this customer." };
    addressSnapshot = {
      fullName: addr.fullName,
      mobile: addr.mobile,
      line1: addr.line1,
      line2: addr.line2 ?? "",
      landmark: addr.landmark ?? "",
      cityTown: addr.cityTown,
      district: addr.district ?? "",
      state: addr.state,
      stateId: addr.stateId ?? "",
      pincode: addr.pincode,
      sourceAddressId: addr.id,
    };
  } else if (input.address) {
    addressSnapshot = { ...input.address };
    savedFromInput = input.address;
  } else {
    return { ok: false, error: "Choose or enter a delivery address for this customer." };
  }

  // Validate + price each line against the CUSTOMER catalogue.
  const validated: {
    productId: string;
    variantId: string | null;
    sellerId: string;
    productName: string;
    variantLabel: string | null;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    imageUrl: string | null;
  }[] = [];
  for (const l of input.lines) {
    const res = await validateCartLine(l.productId, l.variantId ?? null, l.quantity, {
      role: "CUSTOMER",
      dealerStateId: null,
      customerStateId: (addressSnapshot.stateId as string) ?? null,
    });
    if (!res.ok) return { ok: false, error: res.error };
    const line = res.line;
    validated.push({
      productId: line.productId,
      variantId: line.variantId ?? null,
      sellerId: line.sellerId,
      productName: line.productName,
      variantLabel: line.variantLabel ?? null,
      sku: line.sku ?? null,
      quantity: l.quantity,
      unitPrice: round2(line.sellingPrice),
      lineTotal: round2(line.sellingPrice * l.quantity),
      imageUrl: line.productImageUrl ?? null,
    });
  }

  const bySeller = new Map<string, number>();
  for (const v of validated) bySeller.set(v.sellerId, round2((bySeller.get(v.sellerId) ?? 0) + v.lineTotal));
  const grandTotal = round2([...bySeller.values()].reduce((s, n) => s + n, 0));
  const pricingSnapshot = {
    sellers: [...bySeller.entries()].map(([sellerId, subtotal]) => ({ sellerId, subtotal })),
    grandTotal,
    note: "COD, prices locked at proposal time",
  };

  const actorRole = baUser!.role as UserRole;

  const created = await prisma.$transaction(async (tx) => {
    const po = await tx.proposedOrder.create({
      data: {
        baId: ba.id,
        refereeUserId: referee.id,
        status: "AWAITING_REFEREE",
        addressSnapshot: addressSnapshot as Prisma.InputJsonValue,
        pricingSnapshot: pricingSnapshot as Prisma.InputJsonValue,
        grandTotal,
        note: input.note || null,
        items: {
          create: validated.map((v) => ({
            productId: v.productId,
            variantId: v.variantId,
            sellerId: v.sellerId,
            productName: v.productName,
            variantLabel: v.variantLabel,
            sku: v.sku,
            quantity: v.quantity,
            unitPrice: v.unitPrice,
            lineTotal: v.lineTotal,
          })),
        },
      },
      include: { items: true },
    });

    // Reserve stock now (spec #22: "stock locks"). Uses the same choke
    // point every stock change goes through — a failed guard rolls the
    // whole proposal back.
    for (const item of po.items) {
      const r = await recordStockChange(tx, {
        target: item.variantId
          ? { kind: "variant", variantId: item.variantId }
          : { kind: "base", productId: item.productId, audience: "CUSTOMER" },
        change: { mode: "delta", delta: -item.quantity },
        adjustmentType: "ORDER_SALE",
        sourceType: "ORDER",
        relatedOrderId: po.id,
        performedBy: { id: baUserId, role: actorRole },
      });
      if (!r.ok) throw new ProposedStockError(r.error);
      await tx.proposedOrderItem.update({
        where: { id: item.id },
        data: { stockReservationId: po.id },
      });
    }
    return po;
  }).catch((e) => {
    if (e instanceof ProposedStockError) return { __stockError: e.message } as const;
    throw e;
  });

  if ("__stockError" in created) {
    return { ok: false, error: `Could not reserve stock: ${created.__stockError}` };
  }

  // Notify the referee.
  await notifyUser({
    userId: referee.id,
    title: "An order is waiting for your approval",
    body: `${baUser ? "Your Business Associate" : "Someone"} has prepared a COD order for you (₹${grandTotal.toFixed(2)}). Review and approve, edit, or decline it.`,
    linkUrl: `/account/ba/orders/${created.id}`,
  }).catch(() => {});

  // Remember a typed address so it can be saved to the referee's book on approval.
  if (savedFromInput) {
    await prisma.proposedOrder
      .update({
        where: { id: created.id },
        data: { note: created.note ?? undefined },
      })
      .catch(() => {});
  }

  return { ok: true, proposedOrderId: created.id };
}

class ProposedStockError extends Error {}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listProposedOrdersForReferee(userId: string) {
  return prisma.proposedOrder.findMany({
    where: { refereeUserId: userId },
    orderBy: { createdAt: "desc" },
    include: { items: true, ba: { select: { firstName: true, lastName: true, referralCode: true } } },
  });
}

export async function listProposedOrdersForBa(baId: string) {
  return prisma.proposedOrder.findMany({
    where: { baId },
    orderBy: { createdAt: "desc" },
    include: {
      items: true,
      refereeUser: { select: { firstName: true, lastName: true, phone: true } },
    },
  });
}

export async function getProposedOrderForViewer(proposedOrderId: string, viewerUserId: string) {
  const po = await prisma.proposedOrder.findUnique({
    where: { id: proposedOrderId },
    include: {
      items: true,
      ba: { select: { id: true, userId: true, firstName: true, lastName: true, referralCode: true } },
      refereeUser: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  });
  if (!po) return null;
  if (po.refereeUserId !== viewerUserId && po.ba.userId !== viewerUserId) return null;
  return po;
}

// ---------------------------------------------------------------------------
// Decide (referee)
// ---------------------------------------------------------------------------

export async function decideProposedOrder(
  refereeUserId: string,
  proposedOrderId: string,
  decision: "APPROVE" | "REJECT" | "CUSTOMIZE",
): Promise<Result<{ checkoutGroupId?: string }>> {
  const po = await prisma.proposedOrder.findUnique({
    where: { id: proposedOrderId },
    include: { items: true, ba: { select: { id: true, userId: true } } },
  });
  if (!po || po.refereeUserId !== refereeUserId) return { ok: false, error: "Order not found." };
  if (po.status !== "AWAITING_REFEREE") return { ok: false, error: "This order has already been dealt with." };

  const actor = { id: refereeUserId, role: "CUSTOMER" as UserRole };

  // Always release the reservation first — the real order path (or the
  // referee's own cart/checkout) re-deducts.
  await releaseReservation(po.id, po.items, actor);

  if (decision === "REJECT") {
    await prisma.proposedOrder.update({
      where: { id: po.id },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    await notifyBa(po.ba.userId, "Order declined", "The customer declined the order you prepared.");
    return { ok: true };
  }

  if (decision === "CUSTOMIZE") {
    // Push the lines into the referee's own cart (merge by increment).
    for (const item of po.items) {
      const existing = await prisma.cartItem.findFirst({
        where: { userId: refereeUserId, productId: item.productId, variantId: item.variantId },
      });
      if (existing) {
        await prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + item.quantity },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            userId: refereeUserId,
            productId: item.productId,
            variantId: item.variantId,
            sellerId: item.sellerId,
            quantity: item.quantity,
            priceAtAdd: item.unitPrice,
          },
        });
      }
    }
    await prisma.proposedOrder.update({
      where: { id: po.id },
      data: { status: "CUSTOMIZED", decidedAt: new Date() },
    });
    await notifyBa(po.ba.userId, "Order moved to cart", "The customer chose to edit the order themselves.");
    return { ok: true };
  }

  // APPROVE — place the exact lines as a COD order via the normal checkout,
  // transiently swapping the referee's cart so all the battle-tested
  // pricing / licence / charge / stock / idempotency logic is reused.
  const snapshot = await prisma.cartItem.findMany({ where: { userId: refereeUserId } });
  try {
    await prisma.cartItem.deleteMany({ where: { userId: refereeUserId } });
    await prisma.cartItem.createMany({
      data: po.items.map((i) => ({
        userId: refereeUserId,
        productId: i.productId,
        variantId: i.variantId,
        sellerId: i.sellerId,
        quantity: i.quantity,
        priceAtAdd: i.unitPrice,
      })),
    });

    const addr = po.addressSnapshot as {
      fullName: string;
      mobile: string;
      line1: string;
      line2?: string;
      landmark?: string;
      cityTown: string;
      district?: string;
      state: string;
      stateId?: string;
      pincode: string;
      sourceAddressId?: string;
    };
    const result = await checkout(
      refereeUserId,
      {
        role: "CUSTOMER",
        dealerState: null,
        placedBy: { id: po.ba.userId, name: "Business Associate" },
      },
      {
        newAddress: {
          fullName: addr.fullName,
          mobile: addr.mobile,
          altMobile: undefined,
          line1: addr.line1,
          line2: addr.line2 || undefined,
          landmark: addr.landmark || undefined,
          cityTown: addr.cityTown,
          district: addr.district || addr.cityTown,
          state: addr.state,
          stateId: addr.stateId || undefined,
          pincode: addr.pincode,
          addressType: "HOME",
          isDefault: false,
        },
        deliveryMethod: "KISAN4U_COURIER",
        paymentMethod: "COD",
        idempotencyKey: `po_${po.id}`,
      },
    );

    if (!result.ok) {
      // Re-reserve so the proposal can be retried, and surface the error.
      await reReserve(po.id, po.items, { id: po.ba.userId, role: "CUSTOMER" });
      return { ok: false, error: result.error };
    }

    await prisma.proposedOrder.update({
      where: { id: po.id },
      data: { status: "APPROVED", decidedAt: new Date(), checkoutGroupId: result.checkoutGroupId },
    });

    // Save the typed address into the referee's book now that they approved.
    if (!(po.addressSnapshot as Record<string, unknown>).sourceAddressId) {
      await prisma.customerAddress
        .create({
          data: {
            userId: refereeUserId,
            fullName: addr.fullName,
            mobile: addr.mobile,
            line1: addr.line1,
            line2: addr.line2 || null,
            landmark: addr.landmark || null,
            cityTown: addr.cityTown,
            district: addr.district || null,
            state: addr.state,
            stateId: addr.stateId || null,
            pincode: addr.pincode,
            addressType: "HOME",
          },
        })
        .catch(() => {});
    }

    await notifyBa(po.ba.userId, "Order approved", `The customer approved the order — ${result.groupNumber}.`);
    return { ok: true, checkoutGroupId: result.checkoutGroupId };
  } finally {
    // Restore the referee's real cart.
    await prisma.cartItem.deleteMany({ where: { userId: refereeUserId } });
    if (snapshot.length > 0) {
      await prisma.cartItem.createMany({
        data: snapshot.map((c) => ({
          userId: c.userId,
          productId: c.productId,
          variantId: c.variantId,
          sellerId: c.sellerId,
          quantity: c.quantity,
          priceAtAdd: c.priceAtAdd,
          createdAt: c.createdAt,
        })),
      });
    }
  }
}

export async function cancelProposedOrder(
  actorUserId: string,
  proposedOrderId: string,
): Promise<Result> {
  const po = await prisma.proposedOrder.findUnique({
    where: { id: proposedOrderId },
    include: { items: true, ba: { select: { userId: true } } },
  });
  if (!po) return { ok: false, error: "Order not found." };
  if (po.ba.userId !== actorUserId) return { ok: false, error: "Not allowed." };
  if (po.status !== "AWAITING_REFEREE") return { ok: false, error: "This order can no longer be cancelled." };
  await releaseReservation(po.id, po.items, { id: actorUserId, role: "CUSTOMER" });
  await prisma.proposedOrder.update({
    where: { id: po.id },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  return { ok: true };
}

/** Cancels every still-open proposal owned by or addressed to an account before anonymization. */
export async function cancelOpenProposedOrdersForAccount(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, baProfile: { select: { id: true } } },
  });
  if (!user) return 0;
  const proposals = await prisma.proposedOrder.findMany({
    where: {
      status: "AWAITING_REFEREE",
      OR: [
        { refereeUserId: userId },
        ...(user.baProfile ? [{ baId: user.baProfile.id }] : []),
      ],
    },
    include: { items: true },
  });
  for (const proposal of proposals) {
    await releaseReservation(proposal.id, proposal.items, { id: userId, role: user.role });
    await prisma.proposedOrder.updateMany({
      where: { id: proposal.id, status: "AWAITING_REFEREE" },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
  }
  return proposals.length;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type POItem = { id: string; productId: string; variantId: string | null; quantity: number };

async function releaseReservation(
  proposedOrderId: string,
  items: POItem[],
  actor: { id: string; role: UserRole },
): Promise<void> {
  for (const item of items) {
    await recordStockChange(prisma, {
      target: item.variantId
        ? { kind: "variant", variantId: item.variantId }
        : { kind: "base", productId: item.productId, audience: "CUSTOMER" },
      change: { mode: "delta", delta: item.quantity },
      adjustmentType: "ORDER_CANCELLATION_RESTORE",
      sourceType: "CANCELLATION",
      relatedOrderId: proposedOrderId,
      performedBy: actor,
    }).catch(() => {});
  }
}

async function reReserve(
  proposedOrderId: string,
  items: POItem[],
  actor: { id: string; role: UserRole },
): Promise<void> {
  for (const item of items) {
    await recordStockChange(prisma, {
      target: item.variantId
        ? { kind: "variant", variantId: item.variantId }
        : { kind: "base", productId: item.productId, audience: "CUSTOMER" },
      change: { mode: "delta", delta: -item.quantity },
      adjustmentType: "ORDER_SALE",
      sourceType: "ORDER",
      relatedOrderId: proposedOrderId,
      performedBy: actor,
    }).catch(() => {});
  }
}

async function notifyBa(baUserId: string, title: string, body: string): Promise<void> {
  await notifyUser({ userId: baUserId, title, body, linkUrl: "/account/ba" }).catch(() => {});
}
