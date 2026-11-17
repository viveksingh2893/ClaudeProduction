import {
  prisma,
  Prisma,
  type OrderStatus,
  type UserRole,
  type PaymentStatus,
  type PaymentMethod,
  type DeliveryMethod,
} from "@kisan4u/db";
import {
  selectLivePaymentProofSubmissions,
  isPaymentProofFullyApproved,
  requiredPaymentProofAmount,
} from "./pos-payment-proof";
import { resolveReturnWindowMs } from "./settlement-rates";
import { redactOrderContact } from "./contact-redaction";

/**
 * A PENDING PosPaymentProofSubmission is never superseded (an agent can
 * only re-upload over a REJECTED one — see the model's doc comment), so
 * `status: "PENDING"` alone is already "live". A REJECTED one needs the
 * `nextSubmission: null` guard, or a rejection that's since been fixed by
 * a resubmission would flag its checkout group as needing attention
 * forever (the old REJECTED row never changes status once superseded).
 * Used everywhere a "some submission still needs action" filter is
 * pushed down to the DB rather than computed in JS.
 */
const LIVE_PENDING_OR_REJECTED_PROOF: Prisma.PosPaymentProofSubmissionWhereInput = {
  OR: [{ status: "PENDING" }, { status: "REJECTED", nextSubmission: null }],
};
const LIVE_REJECTED_PROOF: Prisma.PosPaymentProofSubmissionWhereInput = {
  status: "REJECTED",
  nextSubmission: null,
};

const SELLER_ORDER_INCLUDE = {
  items: true,
  charge: true,
  shipment: { include: { statusHistory: { orderBy: { createdAt: "asc" as const } } } },
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  pickupPoint: true,
  paymentAllocations: { include: { payment: true } },
  seller: { select: { id: true, shopName: true } },
  refundRequests: { orderBy: { createdAt: "desc" as const } },
} as const;

// --- Customer-facing --------------------------------------------------------

export async function listCheckoutGroupsForCustomer(customerId: string) {
  return prisma.checkoutGroup.findMany({
    where: { customerId },
    include: {
      sellerOrders: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          seller: { select: { shopName: true } },
          // Lean projection — just enough for the order-list page's
          // per-item thumbnail strip (spec §2's "show the product image
          // anywhere an order/order item is displayed as a summary"),
          // not the full SELLER_ORDER_INCLUDE this list doesn't need.
          items: {
            select: {
              id: true,
              productName: true,
              productImageUrl: true,
              variantLabel: true,
              quantity: true,
              productId: true,
              variantId: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Ownership-scoped: returns null (never the row) if this checkout group doesn't belong to the requesting customer. */
export async function getCheckoutGroupForCustomer(customerId: string, checkoutGroupId: string) {
  return prisma.checkoutGroup.findFirst({
    where: { id: checkoutGroupId, customerId },
    include: {
      addressSnapshot: true,
      payments: {
        include: { statusHistory: { orderBy: { createdAt: "asc" } }, allocations: true },
      },
      sellerOrders: { include: SELLER_ORDER_INCLUDE, orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getSellerOrderForCustomer(customerId: string, sellerOrderId: string) {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, customerId },
    include: { ...SELLER_ORDER_INCLUDE, checkoutGroup: { include: { addressSnapshot: true } } },
  });
  if (!order) return null;
  return { ...order, refundRequests: await withReturnWindowExpiryPlaceholders(order) };
}

/**
 * The 48h post-delivery return window (refunds.ts's requestReturn,
 * resolveReturnWindowMs) is enforced server-side on SUBMIT, but neither
 * the website's nor the mobile app's "Request return" button independently
 * checks elapsed time — both simply hide the button whenever
 * `refundRequests` already has an entry for that item, and otherwise show
 * it whenever `order.status === "DELIVERED"` (see request-return-button.tsx
 * / apps/mobile's [sellerOrderId].tsx, both already shipped). Once the
 * window has closed, this appends one synthetic (never persisted, never
 * queryable) entry per item that has no real request yet, so BOTH
 * already-deployed frontends hide the button correctly through their own
 * existing logic — a genuine backend-only fix that needs no web frontend
 * change and, critically, no mobile app rebuild: the mobile app only ever
 * sees this API response's JSON, never this function's TS types.
 */
type ReturnWindowExpiredPlaceholder = {
  id: string;
  orderItemId: string | null;
  status: string;
  refundMethod: string;
  amount: string;
  reason: string;
  createdAt: Date;
};

async function withReturnWindowExpiryPlaceholders<R extends { orderItemId: string | null }>(order: {
  status: OrderStatus;
  statusHistory: { status: OrderStatus; createdAt: Date }[];
  items: { id: string }[];
  refundRequests: R[];
}): Promise<(R | ReturnWindowExpiredPlaceholder)[]> {
  if (order.status !== "DELIVERED") return order.refundRequests;
  const deliveredAt =
    order.statusHistory.filter((h) => h.status === "DELIVERED").at(-1)?.createdAt ?? null;
  if (!deliveredAt) return order.refundRequests;
  const windowMs = await resolveReturnWindowMs();
  if (Date.now() <= deliveredAt.getTime() + windowMs) return order.refundRequests;

  const itemIdsWithRequest = new Set(
    order.refundRequests.map((r) => r.orderItemId).filter((id): id is string => id != null),
  );
  const placeholders: ReturnWindowExpiredPlaceholder[] = order.items
    .filter((item) => !itemIdsWithRequest.has(item.id))
    .map((item) => ({
      id: `window-expired:${item.id}`,
      orderItemId: item.id,
      // Not one of the real RefundRequestStatus enum values on purpose —
      // both frontends render an unrecognized status as this string
      // verbatim (Record<string,string> label lookup with `?? status`
      // fallback), so this doubles as the human-readable label shown.
      status: "Return window closed",
      refundMethod: "WALLET",
      amount: "0.00",
      reason: "The return window for this item has closed.",
      createdAt: new Date(),
    }));
  return [...order.refundRequests, ...placeholders];
}

// --- Seller-facing -----------------------------------------------------------

/**
 * A seller only ever sees an order once Kisan4U's team has confirmed it
 * with the customer (order-workflow.ts's confirmOrder). Detected from the
 * append-only OrderStatusHistory rather than the live `status`, so it stays
 * true even after the order moves on (or back, via CANCELLATION_REQUESTED).
 * Every seller-facing order query below ANDs this in — a still-"Pending"
 * order (or one the scheduling team cancelled outright) is invisible to the
 * seller, exactly as if it did not exist.
 */
const CONFIRMED_WITH_SELLER: Prisma.SellerOrderWhereInput = {
  statusHistory: { some: { status: "CONFIRMED" } },
};

/** Every seller-scoped read below (list, paginated list, single order) returns the buyer's phone numbers redacted — see contact-redaction.ts. */
export async function listSellerOrdersForSeller(sellerId: string, status?: OrderStatus) {
  const orders = await prisma.sellerOrder.findMany({
    where: { sellerId, ...CONFIRMED_WITH_SELLER, ...(status ? { status } : {}) },
    include: { items: true, charge: true, checkoutGroup: { include: { addressSnapshot: true } } },
    orderBy: { createdAt: "desc" },
  });
  return orders.map(redactOrderContact);
}

/** Ownership-scoped: returns null (never the row) if the order doesn't belong to this seller (§O — a seller must not see another seller's order) OR if it has not yet been confirmed by the Kisan4U team. */
export async function getSellerOrderForSeller(sellerId: string, sellerOrderId: string) {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, sellerId, ...CONFIRMED_WITH_SELLER },
    include: {
      ...SELLER_ORDER_INCLUDE,
      // A seller doesn't get the courier's raw label URL (their label comes
      // from getSellerLabelData, without the buyer's phone) or the raw
      // provider payloads — the very first tracking row stores the whole
      // create-shipment request, consignee phone number included.
      shipment: {
        omit: { labelUrl: true },
        include: {
          statusHistory: {
            omit: { rawProviderResponse: true },
            orderBy: { createdAt: "asc" as const },
          },
        },
      },
      checkoutGroup: {
        include: {
          addressSnapshot: true,
          // Who placed this on the buyer's behalf, if anyone: a POS staff
          // member (staffProfile) vs a Business Associate (baProfile) — both
          // set placedByUserId/placedByName through checkout()'s shared
          // placedBy mechanism, so `placedByName != null` alone can't tell
          // them apart (a BA order's placedByName is literally "Business
          // Associate"). Name + referral code only — no contact number.
          placedByUser: {
            select: {
              staffProfile: { select: { id: true } },
              baProfile: { select: { firstName: true, lastName: true, referralCode: true } },
            },
          },
        },
      },
    },
  });
  return order ? redactOrderContact(order) : null;
}

export type SellerOrderFilters = {
  status?: OrderStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
  /**
   * Scopes to orders with at least one RefundRequest of any status (a
   * post-delivery return) OR that ever reached CANCELLATION_REQUESTED
   * (a pre-delivery cancellation, whether approved, rejected, or still
   * pending) — the seller's "Return and Cancel" tab, sharing this same
   * query/table with the regular Orders tab, just this one filter set.
   * Cancellation itself has no persistent request row the way a return
   * does (see cancellation.ts), so "ever cancellation-requested" is
   * detected from OrderStatusHistory instead.
   */
  hasReturnOrCancellationRequest?: boolean;
};

export type SellerOrderSortKey = "orderNumber" | "total" | "status" | "createdAt";

/** Whitelisted — never pass a raw query-string value straight into `orderBy`. Same discipline as ADMIN_ORDER_SORT below, scoped to the sort keys the seller orders table actually offers. */
const SELLER_ORDER_SORT: Record<
  SellerOrderSortKey,
  (dir: "asc" | "desc") => Prisma.SellerOrderOrderByWithRelationInput
> = {
  orderNumber: (dir) => ({ orderNumber: dir }),
  total: (dir) => ({ totalAmount: dir }),
  status: (dir) => ({ status: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

/**
 * Paginated/searchable/filterable/sortable sibling of listSellerOrdersForSeller
 * above — added for the seller orders table (AdminDataTable server mode)
 * without changing that function's signature, since it's also used by
 * apps/web's mobile API route and apps/mobile, neither of which need
 * pagination. Always scoped by sellerId (never a general admin filter) —
 * a seller must not see another seller's orders (§O).
 */
export async function listSellerOrdersForSellerPaginated(
  sellerId: string,
  filters: SellerOrderFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const sortField =
    filters.sortKey && filters.sortKey in SELLER_ORDER_SORT
      ? SELLER_ORDER_SORT[filters.sortKey as SellerOrderSortKey](sortDir)
      : { createdAt: sortDir };

  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.SellerOrderWhereInput = {
    sellerId,
    ...CONFIRMED_WITH_SELLER,
    ...(filters.status ? { status: filters.status } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(filters.hasReturnOrCancellationRequest
      ? {
          OR: [
            { refundRequests: { some: {} } },
            { statusHistory: { some: { status: "CANCELLATION_REQUESTED" } } },
          ],
        }
      : {}),
    ...(filters.search
      ? { orderNumber: { contains: filters.search, mode: "insensitive" as const } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sellerOrder.findMany({
      where,
      include: {
        items: true,
        charge: true,
        checkoutGroup: { include: { addressSnapshot: true } },
        paymentAllocations: { include: { payment: true } },
        // awbNumber, not labelUrl: the row only needs to know a label
        // exists, and the courier's raw URL must not reach the browser.
        shipment: { select: { provider: true, awbNumber: true } },
      },
      orderBy: sortField,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerOrder.count({ where }),
  ]);

  return { rows: rows.map(redactOrderContact), total, page, pageSize };
}

// --- Admin-facing --------------------------------------------------------------

/** Cross-cutting status groups for the admin Orders list's quick tabs — read-only grouping, never touches the status-transition rules themselves (see @kisan4u/orders' canTransition/transitionSellerOrder, which this never calls or duplicates). */
export type AdminOrderStatusGroup =
  | "new"
  | "processing"
  | "inTransit"
  | "delivered"
  | "cancelled"
  | "needsAttention";

const ORDER_STATUS_GROUP: Record<Exclude<AdminOrderStatusGroup, "needsAttention">, OrderStatus[]> = {
  new: ["PENDING_PAYMENT", "PAYMENT_PARTIALLY_RECEIVED"],
  processing: ["CONFIRMED", "SELLER_ACCEPTED", "PACKED"],
  inTransit: ["PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT"],
  delivered: ["DELIVERED"],
  cancelled: ["CANCELLED", "CANCELLATION_REQUESTED"],
};

export type AdminOrderFilters = {
  status?: OrderStatus;
  /** Read-only OR-of-statuses tab, applied in addition to `status` (both AND together, same as every other filter here). "needsAttention" is a delivery-failed OR pending-payment-proof condition instead of a plain status list. */
  statusGroup?: AdminOrderStatusGroup;
  customerType?: UserRole;
  /** Scope to a single customer's order history — used by the admin customer/dealer detail page. Combines with every other filter below via plain AND, same as the rest of this filter set. */
  customerId?: string;
  sellerId?: string;
  state?: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  deliveryMethod?: DeliveryMethod;
  /** CONFIRMED, courier delivery, no Shipment row yet — the Order Scheduling queue's "Ready to schedule" tab. */
  readyToSchedule?: boolean;
  /** Has a RapidShyp-hosted shipping-label URL — the "Labels ready" tab. */
  hasLabel?: boolean;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
  /**
   * Scopes to orders with at least one RefundRequest of any status (a
   * post-delivery return) OR that ever reached CANCELLATION_REQUESTED (a
   * pre-delivery cancellation) — the admin "Return and Cancel" tab
   * (/admin/returns) reuses this same query/table, just with this one
   * filter set. See SellerOrderFilters' identical field for why
   * cancellation is detected from OrderStatusHistory, not a request row.
   */
  hasReturnOrCancellationRequest?: boolean;
};

export type AdminOrderSortKey =
  "orderNumber" | "customer" | "seller" | "total" | "status" | "createdAt";

/** Whitelisted — never pass a raw query-string value straight into `orderBy`. Relation sorts (customer/seller) are valid Prisma `orderBy` shapes, not raw strings. */
const ADMIN_ORDER_SORT: Record<
  AdminOrderSortKey,
  (
    dir: "asc" | "desc",
  ) => Prisma.SellerOrderOrderByWithRelationInput | Prisma.SellerOrderOrderByWithRelationInput[]
> = {
  orderNumber: (dir) => ({ orderNumber: dir }),
  customer: (dir) => [{ customer: { firstName: dir } }, { customer: { lastName: dir } }],
  seller: (dir) => ({ seller: { shopName: dir } }),
  total: (dir) => ({ totalAmount: dir }),
  status: (dir) => ({ status: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

export async function listSellerOrdersForAdmin(filters: AdminOrderFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_ORDER_SORT
      ? ADMIN_ORDER_SORT[filters.sortKey as AdminOrderSortKey](sortDir)
      : { createdAt: sortDir };

  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.SellerOrderWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.statusGroup && filters.statusGroup !== "needsAttention"
      ? { status: { in: ORDER_STATUS_GROUP[filters.statusGroup] } }
      : {}),
    ...(filters.statusGroup === "needsAttention"
      ? {
          OR: [
            { status: "DELIVERY_FAILED" as const },
            {
              paymentMethod: { not: "COD" as const },
              checkoutGroup: {
                placedByUserId: { not: null },
                paymentProofSubmissions: { some: LIVE_PENDING_OR_REJECTED_PROOF },
              },
            },
          ],
        }
      : {}),
    ...(filters.customerType ? { customerType: filters.customerType } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
    ...(filters.deliveryMethod ? { deliveryMethod: filters.deliveryMethod } : {}),
    ...(filters.readyToSchedule
      ? { status: "CONFIRMED" as const, deliveryMethod: "KISAN4U_COURIER" as const, shipment: null }
      : {}),
    ...(filters.hasLabel ? { shipment: { labelUrl: { not: null } } } : {}),
    ...(filters.paymentStatus
      ? { paymentAllocations: { some: { payment: { status: filters.paymentStatus } } } }
      : {}),
    ...(filters.paymentMethod
      ? { paymentAllocations: { some: { payment: { method: filters.paymentMethod } } } }
      : {}),
    // AND (not a bare top-level OR key) — the search clause just below
    // ALSO needs its own top-level OR for its multi-field match, and a
    // second `...( { OR: [...] } )` spread would silently clobber the
    // first rather than combine with it (same object key, last spread
    // wins). Nesting this one under AND keeps both independently active
    // when an admin searches while on the "Return and Cancel" tab.
    ...(filters.hasReturnOrCancellationRequest
      ? {
          AND: [
            {
              OR: [
                { refundRequests: { some: {} } },
                { statusHistory: { some: { status: "CANCELLATION_REQUESTED" as const } } },
              ],
            },
          ],
        }
      : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(filters.state
      ? {
          checkoutGroup: {
            addressSnapshot: { state: { equals: filters.state, mode: "insensitive" } },
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { orderNumber: { contains: filters.search, mode: "insensitive" as const } },
            { customer: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: filters.search } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sellerOrder.findMany({
      where,
      include: {
        seller: { select: { id: true, shopName: true } },
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        shipment: { select: { provider: true, labelUrl: true } },
        charge: true,
        // Internal-remark count for the row's Remarks button (see
        // apps/dashboard order-remarks-button.tsx).
        _count: { select: { notes: true } },
        checkoutGroup: {
          include: {
            addressSnapshot: true,
            // Only ever populated for a POS order (placedByUserId set) with
            // a non-COD payment method — same convention as
            // getSellerOrderForAdmin's own paymentProofSubmissions include.
            // Fetches every submission (not just the latest) since a buyer
            // paying in instalments needs every LIVE one considered — see
            // selectLivePaymentProofSubmissions in admin-order-row.ts.
            paymentProofSubmissions: { orderBy: { createdAt: "desc" } },
            // Distinguishes a real POS order (placedByUserId is a dashboard
            // STAFF member) from a BA-approved order (placedByUserId is the
            // BA's own customer/dealer account — decideProposedOrder in
            // ba/proposed-order.ts reuses the same placedBy mechanism
            // checkout() already had for POS, so `placedByName != null`
            // alone can't tell them apart). See admin-order-row.ts's
            // isPosOrder/isBaOrder.
            placedByUser: {
              select: {
                staffProfile: { select: { id: true } },
                baProfile: {
                  select: { firstName: true, lastName: true, referralCode: true, contactNumber: true },
                },
              },
            },
          },
        },
        paymentAllocations: { include: { payment: true } },
        // The refund (cancel / return / RTO) approved and waiting for the
        // admin to pick a method — drives the table's refund dropdown (see
        // admin-order-row.ts). At most one is ever active per order.
        refundRequests: {
          where: { status: "APPROVED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, amount: true, refundMethod: true, orderItemId: true },
        },
        // Line items — the admin customer/dealer detail pages need
        // "items and quantities" per order; a few rows per order is
        // negligible added cost on an already-paginated list.
        items: {
          select: {
            id: true,
            productName: true,
            variantLabel: true,
            quantity: true,
            unit: true,
            productImageUrl: true,
            productId: true,
            variantId: true,
          },
        },
      },
      orderBy: sortField,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerOrder.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type AdminOrdersOperationalSummary = {
  total: number;
  today: number;
  awaitingConfirmation: number;
  inProgress: number;
  needsAttention: number;
  paymentReviewCount: number;
  deliveryProblemCount: number;
  groupCounts: Record<AdminOrderStatusGroup, number>;
};

/** Powers the Orders list's top metrics + quick-tab counts — counts across the WHOLE order book (read-only, never touches transition rules), same convention as getPosOrdersSummaryForPlacedBy. */
export async function getAdminOrdersOperationalSummary(): Promise<AdminOrdersOperationalSummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total, today, ...groupCountsArr] = await Promise.all([
    prisma.sellerOrder.count(),
    prisma.sellerOrder.count({ where: { createdAt: { gte: todayStart } } }),
    ...(Object.keys(ORDER_STATUS_GROUP) as Exclude<AdminOrderStatusGroup, "needsAttention">[]).map(
      (group) => prisma.sellerOrder.count({ where: { status: { in: ORDER_STATUS_GROUP[group] } } }),
    ),
  ]);
  const [paymentReviewCount, deliveryProblemCount] = await Promise.all([
    prisma.sellerOrder.count({
      where: {
        paymentMethod: { not: "COD" },
        checkoutGroup: {
          placedByUserId: { not: null },
          paymentProofSubmissions: { some: LIVE_PENDING_OR_REJECTED_PROOF },
        },
      },
    }),
    prisma.sellerOrder.count({ where: { status: "DELIVERY_FAILED" } }),
  ]);

  const groupKeys = Object.keys(ORDER_STATUS_GROUP) as Exclude<
    AdminOrderStatusGroup,
    "needsAttention"
  >[];
  const groupCounts = Object.fromEntries(
    groupKeys.map((key, i) => [key, groupCountsArr[i] as number]),
  ) as Record<Exclude<AdminOrderStatusGroup, "needsAttention">, number>;

  return {
    total,
    today,
    awaitingConfirmation: groupCounts.new,
    inProgress: groupCounts.processing + groupCounts.inTransit,
    needsAttention: paymentReviewCount + deliveryProblemCount,
    paymentReviewCount,
    deliveryProblemCount,
    groupCounts: { ...groupCounts, needsAttention: paymentReviewCount + deliveryProblemCount },
  };
}

export type OrderSchedulingSummary = {
  awaitingConfirmation: number;
  readyToSchedule: number;
  labelsReady: number;
  pickupScheduled: number;
};

/** Powers the Order Scheduling queue's top metrics + quick-tab counts. Deliberately limited to signals this codebase actually tracks — there's no call-log/follow-up-due data model yet, so those specific counters aren't included here (see the page's own doc comment). */
export async function getOrderSchedulingSummary(): Promise<OrderSchedulingSummary> {
  const [awaitingConfirmation, readyToSchedule, labelsReady, pickupScheduled] = await Promise.all([
    prisma.sellerOrder.count({ where: { status: { in: ["PENDING_PAYMENT", "PAYMENT_PARTIALLY_RECEIVED"] } } }),
    prisma.sellerOrder.count({
      where: { status: "CONFIRMED", deliveryMethod: "KISAN4U_COURIER", shipment: null },
    }),
    prisma.sellerOrder.count({ where: { shipment: { labelUrl: { not: null } } } }),
    prisma.sellerOrder.count({ where: { status: "PICKUP_SCHEDULED" } }),
  ]);
  return { awaitingConfirmation, readyToSchedule, labelsReady, pickupScheduled };
}

export async function getSellerOrderForAdmin(sellerOrderId: string) {
  return prisma.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: {
      ...SELLER_ORDER_INCLUDE,
      checkoutGroup: {
        include: {
          addressSnapshot: true,
          customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          // Only ever populated for a POS order (placedByUserId set) with a
          // non-COD payment method — see payment-summary.tsx's POS
          // payment-proof review card. Every submission (a buyer paying in
          // instalments has several live slots at once), not just the
          // latest — see selectLivePaymentProofSubmissions.
          paymentProofSubmissions: {
            orderBy: { createdAt: "desc" },
            include: { uploadedBy: { select: { firstName: true, lastName: true } } },
          },
          // See listSellerOrdersForAdmin's identical include for why —
          // distinguishes a real POS order from a BA-approved order, both
          // of which set placedByUserId/placedByName via checkout()'s
          // shared placedBy mechanism.
          placedByUser: {
            select: {
              staffProfile: { select: { id: true } },
              baProfile: {
                select: { firstName: true, lastName: true, referralCode: true, contactNumber: true },
              },
            },
          },
        },
      },
    },
  });
}

export type AdminCheckoutGroupTab = "active" | "needsAttention" | "multiSeller" | "completed" | "cancelled";

export type AdminCheckoutGroupFilters = {
  customerType?: UserRole;
  state?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  /** Matches a group where ANY of its seller orders currently has this status — a checkout group has no single status of its own (see the row-shaping doc comment below). */
  status?: OrderStatus;
  sellerId?: string;
  /** Quick-tab segment, applied on top of every other filter. */
  tab?: AdminCheckoutGroupTab;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

/** Checkout groups with seller orders from more than one distinct seller — computed via one grouped SQL aggregate rather than loading every SellerOrder row into JS (this table can have tens of thousands of rows). Backs both the "Multi-seller" quick tab and its stat card. */
async function getMultiSellerCheckoutGroupIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ checkoutGroupId: string }[]>`
    SELECT "checkoutGroupId" FROM "SellerOrder"
    GROUP BY "checkoutGroupId"
    HAVING COUNT(DISTINCT "sellerId") > 1
  `;
  return rows.map((r) => r.checkoutGroupId);
}

export type AdminCheckoutGroupSortKey =
  "createdAt" | "totalAmount" | "orderCount" | "paymentStatus" | "status";

const CHECKOUT_GROUP_DB_SORTABLE = new Set<AdminCheckoutGroupSortKey>(["createdAt"]);

/**
 * Spec's Checkout Groups table needs several columns (order count, seller
 * count, item count, total amount, a group-level payment/order status)
 * that don't exist as real columns on CheckoutGroup — they're all derived
 * from its sellerOrders/payments relations. WHERE filtering always runs
 * at the DB level (the part that matters for a large table), but sorting
 * by one of those derived columns can't be expressed as a plain Prisma
 * `orderBy` without raw SQL, so for that case this fetches the (already
 * filtered, not full-table) matching set, computes the derived fields,
 * sorts, and paginates in this process rather than in Postgres — still
 * entirely server-side (never "download everything to the browser and
 * filter there," which is what spec explicitly rules out), just not a
 * single indexed query for those specific sort keys. `createdAt` (the
 * default/common case) always uses true DB-level orderBy+skip+take.
 */
export async function listCheckoutGroupsForAdmin(filters: AdminCheckoutGroupFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortDir = filters.sortDir ?? "desc";
  const sortKey: AdminCheckoutGroupSortKey =
    filters.sortKey && (["createdAt", "totalAmount", "orderCount", "paymentStatus", "status"] as const).includes(
      filters.sortKey as AdminCheckoutGroupSortKey,
    )
      ? (filters.sortKey as AdminCheckoutGroupSortKey)
      : "createdAt";
  const useDbSort = CHECKOUT_GROUP_DB_SORTABLE.has(sortKey);

  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const multiSellerIds = filters.tab === "multiSeller" ? await getMultiSellerCheckoutGroupIds() : null;

  const tabWhere: Prisma.CheckoutGroupWhereInput =
    filters.tab === "needsAttention"
      ? {
          OR: [
            {
              payments: { some: { method: { not: "COD" } } },
              paymentProofSubmissions: { some: LIVE_PENDING_OR_REJECTED_PROOF },
            },
            { sellerOrders: { some: { status: "DELIVERY_FAILED" } } },
          ],
        }
      : filters.tab === "active"
        ? {
            sellerOrders: {
              some: { status: { notIn: ["DELIVERED", "CANCELLED"] } },
            },
          }
        : filters.tab === "completed"
          ? { sellerOrders: { every: { status: "DELIVERED" }, some: {} } }
          : filters.tab === "cancelled"
            ? { sellerOrders: { some: { status: "CANCELLED" } } }
            : multiSellerIds
              ? { id: { in: multiSellerIds } }
              : {};

  const where: Prisma.CheckoutGroupWhereInput = {
    ...tabWhere,
    ...(filters.customerType ? { customerType: filters.customerType } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(filters.state
      ? { addressSnapshot: { state: { equals: filters.state, mode: "insensitive" } } }
      : {}),
    ...(filters.status ? { sellerOrders: { some: { status: filters.status } } } : {}),
    ...(filters.sellerId ? { sellerOrders: { some: { sellerId: filters.sellerId } } } : {}),
    ...(filters.paymentMethod ? { payments: { some: { method: filters.paymentMethod } } } : {}),
    ...(filters.paymentStatus ? { payments: { some: { status: filters.paymentStatus } } } : {}),
    ...(filters.search
      ? {
          OR: [
            { groupNumber: { contains: filters.search, mode: "insensitive" as const } },
            { customer: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: filters.search } } },
            { customer: { email: { contains: filters.search, mode: "insensitive" as const } } },
            {
              sellerOrders: {
                some: { orderNumber: { contains: filters.search, mode: "insensitive" as const } },
              },
            },
            {
              sellerOrders: {
                some: { seller: { shopName: { contains: filters.search, mode: "insensitive" as const } } },
              },
            },
          ],
        }
      : {}),
  };

  const include = {
    customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
    addressSnapshot: { select: { state: true } },
    sellerOrders: {
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        sellerId: true,
        seller: { select: { shopName: true } },
        items: { select: { id: true } },
      },
    },
    payments: {
      select: { id: true, method: true, status: true, totalAmount: true, amountPaid: true, walletAmountApplied: true },
      orderBy: { createdAt: "asc" as const },
      take: 1,
    },
    // For the "Needs Attention" distinction (design: COD-pending is
    // informational, only a genuinely stuck payment proof counts) — same
    // criterion as AdminOrderStatusGroup's "needsAttention" group above,
    // applied at the whole-checkout-group level. Fetches every submission
    // (a buyer paying in instalments has several) so needsAttention below
    // can require ALL of them approved, not just the latest.
    paymentProofSubmissions: {
      select: { id: true, status: true, previousSubmissionId: true, amount: true },
      orderBy: { createdAt: "desc" as const },
    },
  } satisfies Prisma.CheckoutGroupInclude;

  const [rowsRaw, total] = await Promise.all([
    prisma.checkoutGroup.findMany({
      where,
      include,
      orderBy: { createdAt: useDbSort ? sortDir : "desc" },
      ...(useDbSort ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
    prisma.checkoutGroup.count({ where }),
  ]);

  const computed = rowsRaw.map((g) => {
    const orderCount = g.sellerOrders.length;
    const sellerCount = new Set(g.sellerOrders.map((o) => o.sellerId)).size;
    const itemCount = g.sellerOrders.reduce((sum, o) => sum + o.items.length, 0);
    const totalAmount = g.sellerOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const distinctStatuses = [...new Set(g.sellerOrders.map((o) => o.status))];
    const primaryPayment = g.payments[0] ?? null;
    const liveProofSubmissions = selectLivePaymentProofSubmissions(g.paymentProofSubmissions);
    const requiredProofAmount = primaryPayment ? requiredPaymentProofAmount(primaryPayment) : 0;
    return {
      ...g,
      orderCount,
      sellerCount,
      itemCount,
      totalAmount,
      distinctStatuses,
      primaryPayment,
      // COD-pending is informational (spec: never a "needs attention"
      // trigger on its own) — only a stuck non-COD payment proof (any
      // live slot not yet approved, or approved slots not yet summing to
      // the required remaining amount) or a failed delivery counts.
      needsAttention:
        (primaryPayment?.method !== "COD" &&
          liveProofSubmissions.length > 0 &&
          !isPaymentProofFullyApproved(liveProofSubmissions, requiredProofAmount)) ||
        distinctStatuses.includes("DELIVERY_FAILED"),
    };
  });

  let rows = computed;
  if (!useDbSort) {
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...computed].sort((a, b) => {
      const av: string | number =
        sortKey === "totalAmount"
          ? a.totalAmount
          : sortKey === "orderCount"
            ? a.orderCount
            : sortKey === "paymentStatus"
              ? (a.primaryPayment?.status ?? "")
              : (a.distinctStatuses[0] ?? "");
      const bv: string | number =
        sortKey === "totalAmount"
          ? b.totalAmount
          : sortKey === "orderCount"
            ? b.orderCount
            : sortKey === "paymentStatus"
              ? (b.primaryPayment?.status ?? "")
              : (b.distinctStatuses[0] ?? "");
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
    const start = (page - 1) * pageSize;
    rows = rows.slice(start, start + pageSize);
  }

  return { rows, total, page, pageSize };
}

export type CheckoutGroupsSummary = {
  total: number;
  today: number;
  multiSeller: number;
  checkoutValue: number;
  needsAttention: number;
};

/** Powers the Checkout Groups list's stat cards + quick-tab counts — counts across the WHOLE table, same convention as the other admin list summaries. */
export async function getCheckoutGroupsSummary(): Promise<CheckoutGroupsSummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total, today, multiSellerIds, checkoutValueAgg, needsAttention] = await Promise.all([
    prisma.checkoutGroup.count(),
    prisma.checkoutGroup.count({ where: { createdAt: { gte: todayStart } } }),
    getMultiSellerCheckoutGroupIds(),
    prisma.sellerOrder.aggregate({ _sum: { totalAmount: true } }),
    prisma.checkoutGroup.count({
      where: {
        OR: [
          {
            payments: { some: { method: { not: "COD" } } },
            paymentProofSubmissions: { some: LIVE_PENDING_OR_REJECTED_PROOF },
          },
          { sellerOrders: { some: { status: "DELIVERY_FAILED" } } },
        ],
      },
    }),
  ]);

  return {
    total,
    today,
    multiSeller: multiSellerIds.length,
    checkoutValue: Number(checkoutValueAgg._sum.totalAmount ?? 0),
    needsAttention,
  };
}

export async function getCheckoutGroupForAdmin(checkoutGroupId: string) {
  return prisma.checkoutGroup.findUnique({
    where: { id: checkoutGroupId },
    include: {
      addressSnapshot: true,
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, role: true } },
      payments: {
        include: { statusHistory: { orderBy: { createdAt: "asc" } }, allocations: true },
      },
      sellerOrders: { include: SELLER_ORDER_INCLUDE, orderBy: { createdAt: "asc" } },
      // Only ever populated for a POS order (placedByUserId set) with a
      // non-COD payment method — reused by /admin/payment-verification's
      // detail page (checkout-group-scoped, so it sees every seller order
      // in a multi-seller cart, not just one) as well as the plain
      // Checkout Groups detail page, which ignores this field.
      paymentProofSubmissions: {
        orderBy: { createdAt: "desc" },
        include: {
          uploadedBy: { select: { id: true, firstName: true, lastName: true } },
          reviewedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
}

// --- POS ("orders I placed") -------------------------------------------------

export type PlacedByCheckoutGroupFilters = {
  status?: OrderStatus;
  /** "active" = not yet DELIVERED/CANCELLED/DELIVERY_FAILED; "needsAttention" = a rejected payment proof or a failed/cancellation-requested order. Takes priority over `status` when both are set — they drive the same quick-tab row and are mutually exclusive in the UI. */
  tab?: "active" | "delivered" | "cancelled" | "needsAttention";
  paymentMethod?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAYMENT_PARTIALLY_RECEIVED",
  "CONFIRMED",
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "CANCELLATION_REQUESTED",
  "DELIVERY_FAILED",
];

const PLACED_BY_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  sellerOrders: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      paymentMethod: true,
      customerType: true,
      seller: { select: { shopName: true } },
      items: { select: { id: true } },
      // Feeds buildOrderAmountEquation per seller order, same as
      // listSellerOrdersForAdmin — the group-level equation on the "My POS
      // orders" list is just each seller order's own equation summed (see
      // sumOrderAmountEquations), not a separate formula.
      charge: { select: { customerPayableTotal: true, promotionalDiscountAmount: true } },
      paymentAllocations: { select: { amount: true, walletAmountApplied: true } },
    },
  },
  payments: {
    select: { id: true, method: true, status: true, totalAmount: true, amountPaid: true, walletAmountApplied: true },
    orderBy: { createdAt: "asc" as const },
    take: 1,
  },
  // Every submission (not just the latest) — a buyer paying in
  // instalments has several concurrent live slots, see
  // selectLivePaymentProofSubmissions.
  paymentProofSubmissions: {
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.CheckoutGroupInclude;

/** Scoped to the agent who placed the order — never a general admin filter (a Sales Agent must only ever see their own POS orders, same discipline as listSellerOrdersForSeller's sellerId scoping). */
export async function listCheckoutGroupsForPlacedBy(
  placedByUserId: string,
  filters: PlacedByCheckoutGroupFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;

  const dateFilter: Prisma.DateTimeFilter | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const tabFilter: Prisma.CheckoutGroupWhereInput =
    filters.tab === "needsAttention"
      ? {
          OR: [
            { paymentProofSubmissions: { some: LIVE_REJECTED_PROOF } },
            { sellerOrders: { some: { status: { in: ["DELIVERY_FAILED", "CANCELLATION_REQUESTED"] } } } },
          ],
        }
      : filters.tab === "active"
        ? { sellerOrders: { some: { status: { in: ACTIVE_ORDER_STATUSES } } } }
        : filters.tab === "delivered"
          ? { sellerOrders: { every: { status: "DELIVERED" }, some: {} } }
          : filters.tab === "cancelled"
            ? { sellerOrders: { some: { status: "CANCELLED" } } }
            : {};

  const where: Prisma.CheckoutGroupWhereInput = {
    placedByUserId,
    ...tabFilter,
    ...(filters.status ? { sellerOrders: { some: { status: filters.status } } } : {}),
    ...(filters.paymentMethod ? { payments: { some: { method: filters.paymentMethod } } } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(filters.search
      ? {
          OR: [
            { groupNumber: { contains: filters.search, mode: "insensitive" as const } },
            { customer: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: filters.search } } },
          ],
        }
      : {}),
  };

  const [rowsRaw, total] = await Promise.all([
    prisma.checkoutGroup.findMany({
      where,
      include: PLACED_BY_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.checkoutGroup.count({ where }),
  ]);

  const rows = rowsRaw.map((g) => ({
    ...g,
    orderCount: g.sellerOrders.length,
    sellerCount: new Set(g.sellerOrders.map((o) => o.seller.shopName)).size,
    itemCount: g.sellerOrders.reduce((sum, o) => sum + o.items.length, 0),
    totalAmount: g.sellerOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
    distinctStatuses: [...new Set(g.sellerOrders.map((o) => o.status))],
    primaryPayment: g.payments[0] ?? null,
    liveSubmissions: selectLivePaymentProofSubmissions(g.paymentProofSubmissions),
  }));

  return { rows, total, page, pageSize };
}

/** Ownership-scoped: returns null (never the row) if this checkout group wasn't placed by this agent — same discipline as getCheckoutGroupForCustomer/getSellerOrderForSeller. */
export async function getCheckoutGroupForPlacedBy(placedByUserId: string, checkoutGroupId: string) {
  return prisma.checkoutGroup.findFirst({
    where: { id: checkoutGroupId, placedByUserId },
    include: {
      addressSnapshot: true,
      customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
      sellerOrders: { include: SELLER_ORDER_INCLUDE, orderBy: { createdAt: "asc" } },
      payments: {
        select: { id: true, method: true, status: true, totalAmount: true, amountPaid: true, walletAmountApplied: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      paymentProofSubmissions: { orderBy: { createdAt: "desc" } },
    },
  });
}

export type PosOrdersSummary = {
  totalOrders: number;
  activeOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  needsAttentionOrders: number;
  salesValue: number;
  cancellationRate: number;
};

/** Powers the POS Orders list's summary cards + needs-attention/cancellation-rate banners — same placedByUserId scoping as listCheckoutGroupsForPlacedBy, deliberately unfiltered by the list's own search/date/status params so the cards read as this agent's whole book, not "matching the current filter". */
export async function getPosOrdersSummaryForPlacedBy(placedByUserId: string): Promise<PosOrdersSummary> {
  const groups = await prisma.checkoutGroup.findMany({
    where: { placedByUserId },
    select: {
      sellerOrders: { select: { status: true, totalAmount: true } },
      paymentProofSubmissions: {
        select: { id: true, status: true, previousSubmissionId: true },
      },
    },
  });

  let activeOrders = 0;
  let deliveredOrders = 0;
  let cancelledOrders = 0;
  let needsAttentionOrders = 0;
  let salesValue = 0;

  for (const g of groups) {
    const statuses = g.sellerOrders.map((o) => o.status);
    salesValue += g.sellerOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const isDelivered = statuses.length > 0 && statuses.every((s) => s === "DELIVERED");
    const isCancelled = statuses.some((s) => s === "CANCELLED");
    const isActive = !isDelivered && statuses.some((s) => ACTIVE_ORDER_STATUSES.includes(s));
    if (isDelivered) deliveredOrders += 1;
    else if (isCancelled) cancelledOrders += 1;
    else if (isActive) activeOrders += 1;

    const hasLiveRejectedProof = selectLivePaymentProofSubmissions(g.paymentProofSubmissions).some(
      (s) => s.status === "REJECTED",
    );
    const hasFailureStatus = statuses.some(
      (s) => s === "DELIVERY_FAILED" || s === "CANCELLATION_REQUESTED",
    );
    if (hasLiveRejectedProof || hasFailureStatus) needsAttentionOrders += 1;
  }

  const totalOrders = groups.length;
  return {
    totalOrders,
    activeOrders,
    deliveredOrders,
    cancelledOrders,
    needsAttentionOrders,
    salesValue,
    cancellationRate: totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0,
  };
}

// --- Payment verification (POS payment-proof review queue) -----------------
//
// Scoped to the whole CheckoutGroup, not one PosPaymentProofSubmission —
// a multi-seller cart's buyer made ONE external payment for every seller
// order in it, and a buyer paying in instalments has several concurrent
// live submissions ("slots") for that one group. One row here = one
// checkout group, carrying every seller order AND every live submission,
// so the reviewer always sees the full picture (not just whichever
// seller order happened to be first, and not just one screenshot out of
// several).

export type PosPaymentProofTab = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Group-level tab membership, expressed as Prisma relational filters so
 * pagination stays a real DB-level query (not "fetch everything, filter
 * in JS"). "PENDING" = at least one live PENDING slot needs a decision.
 * "REJECTED" = at least one live REJECTED slot is waiting on the agent
 * (not actionable by the reviewer, but worth seeing). "APPROVED" = fully
 * verified — no live PENDING or REJECTED slot remains, and at least one
 * slot exists at all.
 */
function posPaymentProofTabWhere(tab: PosPaymentProofTab): Prisma.CheckoutGroupWhereInput {
  if (tab === "PENDING") return { paymentProofSubmissions: { some: { status: "PENDING" } } };
  if (tab === "REJECTED") return { paymentProofSubmissions: { some: LIVE_REJECTED_PROOF } };
  return {
    AND: [
      { paymentProofSubmissions: { none: { status: "PENDING" } } },
      { paymentProofSubmissions: { none: LIVE_REJECTED_PROOF } },
      { paymentProofSubmissions: { some: { status: "APPROVED" } } },
    ],
  };
}

const PROOF_QUEUE_GROUP_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  placedByUser: { select: { id: true, firstName: true, lastName: true } },
  sellerOrders: {
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      paymentMethod: true,
      customerType: true,
      seller: { select: { shopName: true } },
      charge: { select: { customerPayableTotal: true, promotionalDiscountAmount: true } },
      paymentAllocations: { select: { amount: true, walletAmountApplied: true } },
    },
  },
  payments: {
    select: { totalAmount: true, amountPaid: true, walletAmountApplied: true },
    orderBy: { createdAt: "asc" as const },
    take: 1,
  },
  paymentProofSubmissions: {
    orderBy: { createdAt: "desc" as const },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.CheckoutGroupInclude;

export type PosPaymentProofQueueFilters = {
  tab?: PosPaymentProofTab;
  search?: string;
  page?: number;
  pageSize?: number;
};

/**
 * The Payment Verification list's actual default view — every checkout
 * group with a screenshot AWAITING review, oldest-first (longest-waiting
 * proof surfaces first), NOT the general order list admin/orders reuses
 * today. COD orders never produce a row here at all (no
 * PosPaymentProofSubmission is ever created for COD — see the model's
 * own doc comment), so there's nothing to filter out for that case.
 */
export async function listPosPaymentProofQueue(filters: PosPaymentProofQueueFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const tab = filters.tab ?? "PENDING";

  const where: Prisma.CheckoutGroupWhereInput = {
    placedByUserId: { not: null },
    paymentProofSubmissions: { some: {} },
    ...posPaymentProofTabWhere(tab),
    ...(filters.search
      ? {
          OR: [
            { groupNumber: { contains: filters.search, mode: "insensitive" as const } },
            { customer: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: filters.search } } },
          ],
        }
      : {}),
  };

  const [rowsRaw, total] = await Promise.all([
    prisma.checkoutGroup.findMany({
      where,
      include: PROOF_QUEUE_GROUP_INCLUDE,
      // Oldest-waiting-first for the queue an admin actually works through;
      // most-recent-first for the completed/rejected history tabs.
      orderBy: { createdAt: tab === "PENDING" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.checkoutGroup.count({ where }),
  ]);

  // Deliberately returns each seller order's raw fields (paymentMethod,
  // customerType, charge, paymentAllocations) rather than a pre-built
  // amount equation — buildOrderAmountEquation/sumOrderAmountEquations
  // are dashboard-app-local (apps/dashboard/src/lib/order-amount-
  // equation.ts), not part of this package, same reason
  // listCheckoutGroupsForPlacedBy's caller (the POS Orders page) builds
  // its own equation from these same fields instead of this function
  // doing it.
  const rows = rowsRaw.map((g) => {
    const liveSubmissions = selectLivePaymentProofSubmissions(g.paymentProofSubmissions).map((s) => ({
      id: s.id,
      status: s.status,
      claimedAmount: Number(s.amount),
      uploadedBy: s.uploadedBy,
      reviewedBy: s.reviewedBy,
      createdAt: s.createdAt,
      reviewedAt: s.reviewedAt,
      rejectionReason: s.rejectionReason,
    }));
    const oldestWaiting = liveSubmissions
      .filter((s) => s.status === "PENDING")
      .reduce<Date | null>((oldest, s) => (!oldest || s.createdAt < oldest ? s.createdAt : oldest), null);
    const waitingHours = oldestWaiting ? (Date.now() - oldestWaiting.getTime()) / (1000 * 60 * 60) : 0;
    const latestReviewedAt = liveSubmissions.reduce<Date | null>(
      (latest, s) => (s.reviewedAt && (!latest || s.reviewedAt > latest) ? s.reviewedAt : latest),
      null,
    );
    return {
      checkoutGroupId: g.id,
      groupNumber: g.groupNumber,
      createdAt: g.createdAt,
      sellerOrders: g.sellerOrders,
      customer: g.customer,
      placedByUser: g.placedByUser,
      claimedAmountTotal: liveSubmissions.reduce((sum, s) => sum + s.claimedAmount, 0),
      liveSubmissions,
      pendingCount: liveSubmissions.filter((s) => s.status === "PENDING").length,
      approvedCount: liveSubmissions.filter((s) => s.status === "APPROVED").length,
      rejectedCount: liveSubmissions.filter((s) => s.status === "REJECTED").length,
      payment: g.payments[0]
        ? { totalAmount: Number(g.payments[0].totalAmount), amountPaid: Number(g.payments[0].amountPaid) }
        : null,
      latestReviewedAt,
      waitingHours,
      isOverdue: tab === "PENDING" && waitingHours > 24,
    };
  });

  return { rows, total, page, pageSize };
}

export type PosPaymentProofQueueSummary = {
  pendingCount: number;
  overdueCount: number;
  approvedCount: number;
  rejectedCount: number;
};

/** Powers the Payment Verification list's stat cards/tab counts — counts CHECKOUT GROUPS (not individual screenshots) across the WHOLE queue, not the current page, same convention as getPosOrdersSummaryForPlacedBy. */
export async function getPosPaymentProofQueueSummary(): Promise<PosPaymentProofQueueSummary> {
  const baseWhere: Prisma.CheckoutGroupWhereInput = {
    placedByUserId: { not: null },
    paymentProofSubmissions: { some: {} },
  };
  const [pendingGroups, approvedCount, rejectedCount] = await Promise.all([
    prisma.checkoutGroup.findMany({
      where: { ...baseWhere, ...posPaymentProofTabWhere("PENDING") },
      select: { paymentProofSubmissions: { where: { status: "PENDING" }, select: { createdAt: true } } },
    }),
    prisma.checkoutGroup.count({ where: { ...baseWhere, ...posPaymentProofTabWhere("APPROVED") } }),
    prisma.checkoutGroup.count({ where: { ...baseWhere, ...posPaymentProofTabWhere("REJECTED") } }),
  ]);
  const now = Date.now();
  const overdueCount = pendingGroups.filter((g) =>
    g.paymentProofSubmissions.some((s) => (now - s.createdAt.getTime()) / (1000 * 60 * 60) > 24),
  ).length;
  return { pendingCount: pendingGroups.length, overdueCount, approvedCount, rejectedCount };
}
