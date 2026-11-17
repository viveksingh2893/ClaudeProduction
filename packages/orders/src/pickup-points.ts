import { prisma, Prisma, ApplicationStatus } from "@kisan4u/db";
import type { SellerPickupPointInput, PickupPointDecisionInput } from "@kisan4u/validators";
import {
  courierAddressChanged,
  isRegisteredWithAnyCourier,
  syncPickupPointToCouriers,
} from "./courier-pickup-sync";

export type PickupPointResult = { ok: true; pickupPointId: string } | { ok: false; error: string };

/** New pickup points always start PENDING (Phase 4 spec §K2 — "seller may create a pickup point; admin may approve or reject it"), regardless of what an update request might otherwise imply. */
export async function createSellerPickupPoint(
  sellerId: string,
  input: SellerPickupPointInput,
): Promise<PickupPointResult> {
  const created = await prisma.sellerPickupPoint.create({
    data: {
      sellerId,
      name: input.name,
      contactPerson: input.contactPerson,
      mobile: input.mobile,
      line1: input.line1,
      city: input.city,
      district: input.district,
      state: input.state,
      pincode: input.pincode,
      landmark: input.landmark ?? null,
      isDefault: input.isDefault,
      approvalStatus: "PENDING",
    },
  });
  return { ok: true, pickupPointId: created.id };
}

/** Ownership-scoped: a seller must not access or modify another seller's pickup points (§K2). Editing resets approval to PENDING — an already-approved point's details can't silently change without re-review. */
export async function updateSellerPickupPoint(
  sellerId: string,
  input: SellerPickupPointInput,
): Promise<PickupPointResult> {
  if (!input.id) return { ok: false, error: "Missing pickup point id." };
  const existing = await prisma.sellerPickupPoint.findFirst({ where: { id: input.id, sellerId } });
  if (!existing) return { ok: false, error: "Pickup point not found." };

  // A new address goes out to the couriers as a new location on re-approval.
  const bumpRevision =
    isRegisteredWithAnyCourier(existing) && courierAddressChanged(existing, input);

  const updated = await prisma.sellerPickupPoint.update({
    where: { id: existing.id },
    data: {
      ...(bumpRevision ? { courierAddressRevision: { increment: 1 } } : {}),
      name: input.name,
      contactPerson: input.contactPerson,
      mobile: input.mobile,
      line1: input.line1,
      city: input.city,
      district: input.district,
      state: input.state,
      pincode: input.pincode,
      landmark: input.landmark ?? null,
      isDefault: input.isDefault,
      approvalStatus: "PENDING",
      rejectionReason: null,
    },
  });
  return { ok: true, pickupPointId: updated.id };
}

export async function setSellerPickupPointActive(
  sellerId: string,
  pickupPointId: string,
  isActive: boolean,
): Promise<PickupPointResult> {
  const existing = await prisma.sellerPickupPoint.findFirst({
    where: { id: pickupPointId, sellerId },
  });
  if (!existing) return { ok: false, error: "Pickup point not found." };
  await prisma.sellerPickupPoint.update({ where: { id: existing.id }, data: { isActive } });
  return { ok: true, pickupPointId: existing.id };
}

export async function getSellerPickupPoints(sellerId: string) {
  return prisma.sellerPickupPoint.findMany({ where: { sellerId }, orderBy: { createdAt: "desc" } });
}

/** Only active, approved pickup points may be selected for dispatch (§K2) — this is the query the seller's "accept order" pickup-point dropdown must use. */
export async function getSelectablePickupPoints(sellerId: string) {
  return prisma.sellerPickupPoint.findMany({
    where: { sellerId, isActive: true, approvalStatus: "APPROVED" },
    orderBy: { isDefault: "desc" },
  });
}

export type AdminPickupPointSortKey = "createdAt" | "name" | "approvalStatus";
const ADMIN_PICKUP_POINT_SORT: Record<AdminPickupPointSortKey, keyof Prisma.SellerPickupPointOrderByWithRelationInput> = {
  createdAt: "createdAt",
  name: "name",
  approvalStatus: "approvalStatus",
};

export type ListPickupPointsFilters = {
  q?: string;
  approvalStatus?: ApplicationStatus;
  isActive?: boolean;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

export async function getAllPickupPointsForAdmin(filters: ListPickupPointsFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_PICKUP_POINT_SORT ? ADMIN_PICKUP_POINT_SORT[filters.sortKey as AdminPickupPointSortKey] : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const q = filters.q?.trim();

  const where: Prisma.SellerPickupPointWhereInput = {
    ...(filters.approvalStatus ? { approvalStatus: filters.approvalStatus } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { city: { contains: q, mode: "insensitive" as const } },
            { seller: { shopName: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sellerPickupPoint.findMany({
      where,
      include: { seller: { select: { id: true, shopName: true } } },
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerPickupPoint.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type PickupPointDecisionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

export async function decidePickupPoint(
  input: PickupPointDecisionInput,
): Promise<PickupPointDecisionResult> {
  const existing = await prisma.sellerPickupPoint.findUnique({
    where: { id: input.pickupPointId },
  });
  if (!existing) return { ok: false, error: "Pickup point not found." };

  await prisma.sellerPickupPoint.update({
    where: { id: existing.id },
    data: {
      approvalStatus: input.approve ? "APPROVED" : "REJECTED",
      rejectionReason: input.approve ? null : (input.rejectionReason ?? "Not specified"),
    },
  });

  // Register this point as a pickup location on RapidShyp and every
  // Delhivery account the moment it is approved, so either courier can
  // dispatch from it right away. Non-fatal: approval still goes through if
  // registration fails, and dispatch retries it lazily.
  const warning = input.approve ? (await syncPickupPointToCouriers(existing.id)).warning : undefined;
  return warning ? { ok: true, warning } : { ok: true };
}

// --- Admin acting on a seller's behalf (§K2 extended) ----------------------

export type AdminPickupPointResult =
  | { ok: true; pickupPointId: string; warning?: string }
  | { ok: false; error: string };

type AdminPickupPointFields = SellerPickupPointInput & { isActive?: boolean };

/**
 * Admin creates a pickup point for a seller. Starts PENDING like the
 * seller's own path; when `approveNow` is set the admin (who is the
 * reviewer) is approving in the same step, so it runs decidePickupPoint's
 * exact approval + Delhivery-registration path rather than duplicating it.
 */
export async function adminCreatePickupPoint(
  sellerId: string,
  input: AdminPickupPointFields,
  opts: { approveNow?: boolean } = {},
): Promise<AdminPickupPointResult> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true },
  });
  if (!seller) return { ok: false, error: "Seller not found." };

  const created = await prisma.sellerPickupPoint.create({
    data: {
      sellerId,
      name: input.name,
      contactPerson: input.contactPerson,
      mobile: input.mobile,
      line1: input.line1,
      city: input.city,
      district: input.district,
      state: input.state,
      pincode: input.pincode,
      landmark: input.landmark ?? null,
      isDefault: input.isDefault,
      isActive: input.isActive ?? true,
      approvalStatus: "PENDING",
    },
  });

  if (opts.approveNow) {
    const decision = await decidePickupPoint({ pickupPointId: created.id, approve: true });
    if (!decision.ok) return { ok: false, error: decision.error };
    return { ok: true, pickupPointId: created.id, warning: decision.warning };
  }
  return { ok: true, pickupPointId: created.id };
}

/**
 * Admin edits any seller's pickup point. Unlike updateSellerPickupPoint
 * this does NOT bounce approvalStatus back to PENDING — the admin is the
 * reviewer, and a bounce would silently pull an in-use point out of
 * dispatch. An address change on an approved point is pushed to RapidShyp
 * and Delhivery straight away as a new courier location revision (see
 * courier-pickup-sync.ts); shipments already booked keep the old one.
 */
export async function adminUpdatePickupPoint(
  pickupPointId: string,
  input: AdminPickupPointFields,
): Promise<AdminPickupPointResult> {
  const existing = await prisma.sellerPickupPoint.findUnique({ where: { id: pickupPointId } });
  if (!existing) return { ok: false, error: "Pickup point not found." };

  const addressChanged = courierAddressChanged(existing, input);
  const bumpRevision = addressChanged && isRegisteredWithAnyCourier(existing);

  await prisma.sellerPickupPoint.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      contactPerson: input.contactPerson,
      mobile: input.mobile,
      line1: input.line1,
      city: input.city,
      district: input.district,
      state: input.state,
      pincode: input.pincode,
      landmark: input.landmark ?? null,
      isDefault: input.isDefault,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(bumpRevision ? { courierAddressRevision: { increment: 1 } } : {}),
    },
  });

  if (existing.approvalStatus === "APPROVED" && addressChanged) {
    const { warning } = await syncPickupPointToCouriers(existing.id);
    return { ok: true, pickupPointId: existing.id, ...(warning ? { warning } : {}) };
  }
  return { ok: true, pickupPointId: existing.id };
}

/** Admin "Sync to couriers": (re-)registers an approved point on RapidShyp and every Delhivery account. */
export async function adminSyncPickupPointToCouriers(
  pickupPointId: string,
): Promise<PickupPointDecisionResult> {
  const existing = await prisma.sellerPickupPoint.findUnique({
    where: { id: pickupPointId },
    select: { approvalStatus: true },
  });
  if (!existing) return { ok: false, error: "Pickup point not found." };
  if (existing.approvalStatus !== "APPROVED")
    return { ok: false, error: "Only an approved pickup point can be registered with the couriers." };
  const { warning } = await syncPickupPointToCouriers(pickupPointId);
  return warning ? { ok: true, warning } : { ok: true };
}
