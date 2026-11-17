import { prisma, Prisma, SellerProductRequestStatus } from "@kisan4u/db";
import {
  productRequestInputSchema,
  type ProductRequestInput,
  approveProductRequestInputSchema,
  type ApproveProductRequestInput,
  rejectProductRequestInputSchema,
  type RejectProductRequestInput,
} from "@kisan4u/validators";
import { isProductAvailableForState } from "./availability";

/**
 * "Request This Product" — a dealer enquiry, explicitly NOT an order: no
 * stock reservation, no price calculation, no payment, no shipment. Goes
 * through an admin review gate before the seller ever sees it — see
 * schema.prisma SellerProductRequest doc comment for the full status
 * lifecycle. dealerId always comes from the caller's authenticated session
 * (see apps/web/src/app/dealer/requests/actions.ts); sellerId and
 * deliveryStateId are always re-derived here (from the product row and the
 * dealer's own verified profile respectively), never trusted from client
 * input.
 */
export type CreateRequestResult =
  { ok: true; requestId: string; publicRequestNumber: string } | { ok: false; error: string };

/** REQ- + 8 base36 chars from a cuid-strength random source — safe to show publicly, never the raw row id. */
function generatePublicRequestNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids visual ambiguity when read aloud/typed
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `REQ-${suffix}`;
}

export async function createProductRequest(
  dealerId: string,
  rawInput: ProductRequestInput,
): Promise<CreateRequestResult> {
  const parsed = productRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;

  const dealer = await prisma.dealerProfile.findUnique({
    where: { id: dealerId },
    select: { status: true, stateId: true },
  });
  if (!dealer || dealer.status !== "APPROVED") {
    return { ok: false, error: "Only an approved dealer can submit a request." };
  }
  if (!dealer.stateId) {
    return { ok: false, error: "Your dealer profile has no verified delivery state on file yet." };
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      sellerId: true,
      lifecycleStatus: true,
      audience: true,
      dealerVisible: true,
      dealerAvailableStates: { select: { id: true } },
    },
  });
  if (!product || !product.sellerId) return { ok: false, error: "Product not found." };
  if (product.lifecycleStatus !== "APPROVED")
    return { ok: false, error: "This product is not currently available." };
  if (
    !product.dealerVisible ||
    (product.audience !== "DEALER_ONLY" && product.audience !== "BOTH_CUSTOMER_AND_DEALER")
  ) {
    return { ok: false, error: "This product is not available to dealers." };
  }

  // The entire point of "Request This Product" is that it's NOT available
  // for the dealer's own verified state — if it already is, there's
  // nothing to request; the dealer should just buy it (see
  // apps/web/src/app/dealer/products/[id]/page.tsx, which only ever links
  // here for the STATE_UNAVAILABLE reason).
  if (isProductAvailableForState(product.dealerAvailableStates, dealer.stateId)) {
    return {
      ok: false,
      error: "This product is already available for delivery to your state — no request needed.",
    };
  }

  let variantId: string | null = null;
  if (input.variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true, productId: true, audience: true, isActive: true },
    });
    if (!variant || variant.productId !== product.id)
      return { ok: false, error: "Selected variant does not belong to this product." };
    if (variant.audience !== "DEALER")
      return { ok: false, error: "Selected variant is not available to dealers." };
    if (!variant.isActive) return { ok: false, error: "Selected variant is not currently active." };
    variantId = variant.id;
  }

  // publicRequestNumber collisions are astronomically unlikely (32^8
  // keyspace) but the column is uniquely constrained, so retry a couple of
  // times rather than trusting probability alone.
  for (let attempt = 0; attempt < 5; attempt++) {
    const publicRequestNumber = generatePublicRequestNumber();
    try {
      const created = await prisma.sellerProductRequest.create({
        data: {
          dealerId,
          sellerId: product.sellerId,
          productId: product.id,
          variantId,
          publicRequestNumber,
          quantity: input.quantity,
          deliveryAddress: input.deliveryAddress,
          deliveryStateId: dealer.stateId,
          neededByDate: input.neededByDate ? new Date(`${input.neededByDate}T00:00:00.000Z`) : null,
          note: input.note || null,
        },
      });
      return { ok: true, requestId: created.id, publicRequestNumber: created.publicRequestNumber };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return { ok: false, error: "Could not generate a request number — please try again." };
}

// Full detail, including dealer identity and the raw note — only ever used
// for the dealer's own view of their own request, and the admin view.
const FULL_INCLUDE = {
  product: { select: { id: true, name: true, slug: true, primaryImageUrl: true } },
  variant: { select: { id: true, sku: true } },
  dealer: {
    select: {
      id: true,
      storeName: true,
      storeAddress: true,
      city: true,
      gstNumber: true,
      gstDocUrl: true,
      licenseNumber: true,
      licenseDocUrl: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
    },
  },
  seller: { select: { id: true, shopName: true, user: { select: { id: true } } } },
  deliveryState: { select: { id: true, name: true } },
} as const;

// Seller-safe subset — deliberately omits `dealer` entirely (id, storeName,
// every identity/contact/document field), `deliveryAddress`, and `note`
// (the dealer's raw free-text requirement). Sellers only ever see the
// admin-authored `sellerVisibleSummary`. Never widen this to add dealer
// fields — see spec §8 "strict dealer anonymity".
const SELLER_SAFE_SELECT = {
  id: true,
  publicRequestNumber: true,
  quantity: true,
  neededByDate: true,
  status: true,
  sellerVisibleSummary: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { id: true, name: true, slug: true, primaryImageUrl: true } },
  variant: { select: { id: true, sku: true } },
  deliveryState: { select: { id: true, name: true } },
} as const;

// A seller may only ever reach an admin-approved (or later) request — never
// one still awaiting review or one the admin rejected.
const SELLER_VISIBLE_STATUSES: SellerProductRequestStatus[] = [
  "APPROVED",
  "VIEWED",
  "RESPONDED",
  "CLOSED",
  "CANCELLED",
];

export async function getDealerRequests(dealerId: string) {
  return prisma.sellerProductRequest.findMany({
    where: { dealerId },
    include: FULL_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export async function getSellerRequests(sellerId: string) {
  return prisma.sellerProductRequest.findMany({
    where: { sellerId, status: { in: SELLER_VISIBLE_STATUSES } },
    select: SELLER_SAFE_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

/** Ownership-scoped single-request fetch — returns null (not the row) if it isn't this exact dealer's own request. */
export async function getDealerRequestById(dealerId: string, requestId: string) {
  return prisma.sellerProductRequest.findFirst({
    where: { id: requestId, dealerId },
    include: FULL_INCLUDE,
  });
}

/**
 * Ownership-scoped single-request fetch for the seller's own request
 * detail page — returns null if it isn't a request for this exact
 * seller's own product, OR if it isn't yet admin-approved (pending/
 * rejected requests must never be reachable by a seller, including by
 * guessing/bookmarking a URL).
 */
export async function getSellerRequestById(sellerId: string, requestId: string) {
  return prisma.sellerProductRequest.findFirst({
    where: { id: requestId, sellerId, status: { in: SELLER_VISIBLE_STATUSES } },
    select: SELLER_SAFE_SELECT,
  });
}

export type RequestActionResult = { ok: true } | { ok: false; error: string };

/** Seller may move their own (already admin-approved) request to VIEWED/RESPONDED/CLOSED — never CANCELLED (that's dealer-only, see cancelProductRequestAsDealer). */
export async function updateRequestStatusAsSeller(
  sellerId: string,
  requestId: string,
  status: "VIEWED" | "RESPONDED" | "CLOSED",
): Promise<RequestActionResult> {
  const request = await prisma.sellerProductRequest.findFirst({
    where: { id: requestId, sellerId, status: { in: SELLER_VISIBLE_STATUSES } },
    select: { id: true },
  });
  if (!request) return { ok: false, error: "Request not found." };
  await prisma.sellerProductRequest.update({ where: { id: requestId }, data: { status } });
  return { ok: true };
}

/** Dealer may cancel their own still-open request, whether or not it has been forwarded to the seller yet. */
export async function cancelProductRequestAsDealer(
  dealerId: string,
  requestId: string,
): Promise<RequestActionResult> {
  const request = await prisma.sellerProductRequest.findFirst({
    where: { id: requestId, dealerId },
    select: { id: true, status: true },
  });
  if (!request) return { ok: false, error: "Request not found." };
  if (
    request.status === "CLOSED" ||
    request.status === "CANCELLED" ||
    request.status === "REJECTED"
  ) {
    return { ok: false, error: "This request is already closed." };
  }
  await prisma.sellerProductRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
  return { ok: true };
}

export type SellerRequestSortKey = "createdAt" | "quantity" | "status";
const SELLER_REQUEST_SORT: Record<
  SellerRequestSortKey,
  keyof Prisma.SellerProductRequestOrderByWithRelationInput
> = {
  createdAt: "createdAt",
  quantity: "quantity",
  status: "status",
};

export type SellerRequestFilters = {
  q?: string;
  status?: SellerProductRequestStatus;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

/**
 * Paginated/searchable/filterable/sortable sibling of getSellerRequests
 * above — same seller-safe SELECT and same SELLER_VISIBLE_STATUSES gate.
 * Always scoped by sellerId — a seller must not see another seller's
 * dealer requests. Search is by product name only (never dealer identity —
 * there is none in this projection to search).
 */
export async function getSellerRequestsPaginated(
  sellerId: string,
  filters: SellerRequestFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortField =
    filters.sortKey && filters.sortKey in SELLER_REQUEST_SORT
      ? SELLER_REQUEST_SORT[filters.sortKey as SellerRequestSortKey]
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const q = filters.q?.trim();
  const dateFilter =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.SellerProductRequestWhereInput = {
    sellerId,
    status: filters.status ? filters.status : { in: SELLER_VISIBLE_STATUSES },
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(q ? { product: { name: { contains: q, mode: "insensitive" as const } } } : {}),
  };
  // A seller-supplied status filter must still be restricted to
  // seller-visible statuses — never let a status filter param smuggle in
  // PENDING/REJECTED.
  if (filters.status && !SELLER_VISIBLE_STATUSES.includes(filters.status)) {
    return { rows: [], total: 0, page, pageSize };
  }

  const [rows, total] = await Promise.all([
    prisma.sellerProductRequest.findMany({
      where,
      select: SELLER_SAFE_SELECT,
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerProductRequest.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

/** Admin read-only listing across every seller. */
export type AdminProductRequestSortKey = "createdAt" | "quantity" | "status";
const ADMIN_PRODUCT_REQUEST_SORT: Record<
  AdminProductRequestSortKey,
  keyof Prisma.SellerProductRequestOrderByWithRelationInput
> = {
  createdAt: "createdAt",
  quantity: "quantity",
  status: "status",
};

export type ListProductRequestsFilters = {
  q?: string;
  status?: SellerProductRequestStatus;
  stateId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

export async function getAllProductRequestsForAdmin(filters: ListProductRequestsFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_PRODUCT_REQUEST_SORT
      ? ADMIN_PRODUCT_REQUEST_SORT[filters.sortKey as AdminProductRequestSortKey]
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const q = filters.q?.trim();
  const dateFilter =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.SellerProductRequestWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.stateId ? { deliveryStateId: filters.stateId } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(q
      ? {
          OR: [
            { publicRequestNumber: { contains: q, mode: "insensitive" as const } },
            { product: { name: { contains: q, mode: "insensitive" as const } } },
            { dealer: { storeName: { contains: q, mode: "insensitive" as const } } },
            { seller: { shopName: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sellerProductRequest.findMany({
      where,
      include: FULL_INCLUDE,
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerProductRequest.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

/** Full admin detail view — every field, including dealer identity, the raw note, and internal admin notes. */
export async function getAdminRequestById(requestId: string) {
  return prisma.sellerProductRequest.findUnique({
    where: { id: requestId },
    include: FULL_INCLUDE,
  });
}

export type AdminRequestActionResult = { ok: true } | { ok: false; error: string };

/**
 * Admin approves and forwards a request to the seller. Requires a
 * sellerVisibleSummary (the sanitized version of the dealer's raw `note`)
 * — this is deliberate: an admin cannot forward a request without first
 * reviewing and rewriting it into something safe to hand to the seller.
 * Approval never touches Product/ProductDealerConfig/CartItem — it is
 * purely a status + visibility change on this row (spec §7).
 */
export async function approveProductRequest(
  rawInput: ApproveProductRequestInput,
): Promise<AdminRequestActionResult> {
  const parsed = approveProductRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;

  const request = await prisma.sellerProductRequest.findUnique({
    where: { id: input.requestId },
    select: { status: true },
  });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING")
    return { ok: false, error: "Only a pending request can be approved." };

  await prisma.sellerProductRequest.update({
    where: { id: input.requestId },
    data: {
      status: "APPROVED",
      sellerVisibleSummary: input.sellerVisibleSummary,
      adminNotes: input.adminNotes || null,
    },
  });
  return { ok: true };
}

export async function rejectProductRequest(
  rawInput: RejectProductRequestInput,
): Promise<AdminRequestActionResult> {
  const parsed = rejectProductRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;

  const request = await prisma.sellerProductRequest.findUnique({
    where: { id: input.requestId },
    select: { status: true },
  });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING")
    return { ok: false, error: "Only a pending request can be rejected." };

  await prisma.sellerProductRequest.update({
    where: { id: input.requestId },
    data: {
      status: "REJECTED",
      rejectionReason: input.rejectionReason,
      adminNotes: input.adminNotes || null,
    },
  });
  return { ok: true };
}
