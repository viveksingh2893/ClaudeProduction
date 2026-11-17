import { prisma } from "@kisan4u/db";

/**
 * Read-only views a Business Associate sees of the people they referred
 * (User.referredByBaId — set once, at registration) and of those people's
 * orders. Covers both orders a referee placed for themselves and orders the
 * BA proposed on the referee's behalf that the referee then approved (an
 * approved ProposedOrder becomes an ordinary checkout by the referee, so it
 * shows up here too — flagged `placedByBa`).
 */

export type BaRefereeRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  joinedAt: Date;
  /** Orders that weren't cancelled. */
  orderCount: number;
  /** Sum of what those orders cost the referee (net of any discount, delivery included). */
  orderValue: number;
};

export async function listBaReferees(baId: string): Promise<BaRefereeRow[]> {
  const referees = await prisma.user.findMany({
    where: { referredByBaId: baId, isGuest: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, firstName: true, lastName: true, phone: true, role: true, createdAt: true },
  });
  if (referees.length === 0) return [];

  const orders = await prisma.sellerOrder.findMany({
    where: { customerId: { in: referees.map((r) => r.id) }, status: { not: "CANCELLED" } },
    select: {
      customerId: true,
      totalAmount: true,
      charge: { select: { customerPayableTotal: true } },
    },
  });
  const totals = new Map<string, { count: number; value: number }>();
  for (const o of orders) {
    const entry = totals.get(o.customerId) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += Number(o.charge?.customerPayableTotal ?? o.totalAmount);
    totals.set(o.customerId, entry);
  }

  return referees.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    role: r.role,
    joinedAt: r.createdAt,
    orderCount: totals.get(r.id)?.count ?? 0,
    orderValue: Math.round((totals.get(r.id)?.value ?? 0) * 100) / 100,
  }));
}

export type BaRefereeOrderRow = {
  id: string;
  orderNumber: string;
  checkoutGroupId: string;
  status: string;
  paymentMethod: string;
  createdAt: Date;
  total: number;
  refereeFirstName: string | null;
  refereeLastName: string | null;
  refereePhone: string | null;
  /** True when the BA proposed this order and the referee approved it. */
  placedByBa: boolean;
  items: {
    id: string;
    productName: string;
    variantLabel: string | null;
    quantity: number;
    imageUrl: string | null;
  }[];
};

/** The referees' most recent orders (newest first), with line items and product images. */
export async function listBaRefereeOrders(baId: string, take = 50): Promise<BaRefereeOrderRow[]> {
  const [orders, approvedProposals] = await Promise.all([
    prisma.sellerOrder.findMany({
      where: { customer: { referredByBaId: baId, isGuest: false } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        orderNumber: true,
        checkoutGroupId: true,
        status: true,
        paymentMethod: true,
        createdAt: true,
        totalAmount: true,
        charge: { select: { customerPayableTotal: true } },
        customer: { select: { firstName: true, lastName: true, phone: true } },
        items: {
          select: {
            id: true,
            productName: true,
            variantLabel: true,
            quantity: true,
            productImageUrl: true,
          },
        },
      },
    }),
    prisma.proposedOrder.findMany({
      where: { baId, checkoutGroupId: { not: null } },
      select: { checkoutGroupId: true },
    }),
  ]);
  const proposedGroupIds = new Set(
    approvedProposals.map((p) => p.checkoutGroupId).filter((id): id is string => id != null),
  );

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    checkoutGroupId: o.checkoutGroupId,
    status: o.status,
    paymentMethod: o.paymentMethod,
    createdAt: o.createdAt,
    total: Number(o.charge?.customerPayableTotal ?? o.totalAmount),
    refereeFirstName: o.customer.firstName,
    refereeLastName: o.customer.lastName,
    refereePhone: o.customer.phone,
    placedByBa: proposedGroupIds.has(o.checkoutGroupId),
    items: o.items.map((i) => ({
      id: i.id,
      productName: i.productName,
      variantLabel: i.variantLabel,
      quantity: i.quantity,
      imageUrl: i.productImageUrl || null,
    })),
  }));
}

/** productId → primary image URL, for screens (like a pending proposed order) whose line items don't carry an image of their own. */
export async function getProductImageUrls(productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, primaryImageUrl: true },
  });
  return new Map(
    products.filter((p) => p.primaryImageUrl).map((p) => [p.id, p.primaryImageUrl as string]),
  );
}
