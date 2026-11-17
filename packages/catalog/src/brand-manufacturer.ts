import { prisma, ApplicationStatus } from "@kisan4u/db";
import type { BrandManufacturerDecisionInput } from "@kisan4u/validators";

export type BrandManufacturerResult = { ok: true } | { ok: false; error: string };

function nextStatus(action: BrandManufacturerDecisionInput["action"]): ApplicationStatus {
  switch (action) {
    case "APPROVE":
      return ApplicationStatus.APPROVED;
    case "REJECT":
      return ApplicationStatus.REJECTED;
    case "SUSPEND":
      return ApplicationStatus.SUSPENDED;
    case "REACTIVATE":
      return ApplicationStatus.APPROVED;
    case "DEACTIVATE":
      return ApplicationStatus.INACTIVE;
  }
}

/**
 * Seller-submitted brand/manufacturer requests always start PENDING and
 * privately owned by the submitting seller (ownerSellerId comes from the
 * session-derived caller, never the request body — see
 * apps/dashboard/src/app/seller/brands/actions.ts). There is deliberately
 * no "seller approves their own submission" path anywhere: approval only
 * exists on the admin-gated decide* functions below, called from
 * apps/dashboard/src/app/admin/brands/actions.ts which requires ADMIN.
 */
export async function createBrandRequest(
  sellerId: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<BrandManufacturerResult> {
  const clash = await prisma.brand.findFirst({
    where: { OR: [{ name: input.name }, { slug: input.slug }] },
  });
  if (clash) return { ok: false, error: "A brand with this name or slug already exists." };
  await prisma.brand.create({
    data: {
      name: input.name,
      slug: input.slug,
      imageUrl: input.imageUrl || null,
      status: "PENDING",
      ownerSellerId: sellerId,
    },
  });
  return { ok: true };
}

export async function createManufacturerRequest(
  sellerId: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<BrandManufacturerResult> {
  const clash = await prisma.manufacturer.findFirst({
    where: { OR: [{ name: input.name }, { slug: input.slug }] },
  });
  if (clash) return { ok: false, error: "A manufacturer with this name or slug already exists." };
  await prisma.manufacturer.create({
    data: {
      name: input.name,
      slug: input.slug,
      imageUrl: input.imageUrl || null,
      status: "PENDING",
      ownerSellerId: sellerId,
    },
  });
  return { ok: true };
}

/** Admin-only decision — approve/reject-with-reason/suspend/reactivate/deactivate. Caller must verify ADMIN role first. */
export async function decideBrand(
  id: string,
  action: BrandManufacturerDecisionInput["action"],
  reason?: string,
): Promise<BrandManufacturerResult> {
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return { ok: false, error: "Brand not found." };
  await prisma.brand.update({
    where: { id },
    data: {
      status: nextStatus(action),
      rejectionReason: action === "REJECT" ? (reason ?? "Not specified") : null,
    },
  });
  return { ok: true };
}

export async function decideManufacturer(
  id: string,
  action: BrandManufacturerDecisionInput["action"],
  reason?: string,
): Promise<BrandManufacturerResult> {
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id } });
  if (!manufacturer) return { ok: false, error: "Manufacturer not found." };
  await prisma.manufacturer.update({
    where: { id },
    data: {
      status: nextStatus(action),
      rejectionReason: action === "REJECT" ? (reason ?? "Not specified") : null,
    },
  });
  return { ok: true };
}

/** Re-submits a seller's own PENDING/REJECTED request — a rejected request goes back to PENDING for another admin look. */
export async function updateBrandRequest(
  id: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<BrandManufacturerResult> {
  const clash = await prisma.brand.findFirst({
    where: { OR: [{ name: input.name }, { slug: input.slug }], NOT: { id } },
  });
  if (clash) return { ok: false, error: "A brand with this name or slug already exists." };
  await prisma.brand.update({
    where: { id },
    data: {
      name: input.name,
      slug: input.slug,
      imageUrl: input.imageUrl || null,
      status: "PENDING",
      rejectionReason: null,
    },
  });
  return { ok: true };
}

export async function updateManufacturerRequest(
  id: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<BrandManufacturerResult> {
  const clash = await prisma.manufacturer.findFirst({
    where: { OR: [{ name: input.name }, { slug: input.slug }], NOT: { id } },
  });
  if (clash) return { ok: false, error: "A manufacturer with this name or slug already exists." };
  await prisma.manufacturer.update({
    where: { id },
    data: {
      name: input.name,
      slug: input.slug,
      imageUrl: input.imageUrl || null,
      status: "PENDING",
      rejectionReason: null,
    },
  });
  return { ok: true };
}

/** A seller may edit only their own not-yet-decided (PENDING) or previously-rejected request, and only before it's been approved. */
export async function assertSellerOwnsEditableBrand(
  sellerId: string,
  id: string,
): Promise<BrandManufacturerResult> {
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return { ok: false, error: "Brand not found." };
  if (brand.ownerSellerId !== sellerId)
    return { ok: false, error: "You do not own this brand request." };
  if (brand.status !== "PENDING" && brand.status !== "REJECTED") {
    return { ok: false, error: "Only a pending or rejected request can be edited." };
  }
  return { ok: true };
}

export async function assertSellerOwnsEditableManufacturer(
  sellerId: string,
  id: string,
): Promise<BrandManufacturerResult> {
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id } });
  if (!manufacturer) return { ok: false, error: "Manufacturer not found." };
  if (manufacturer.ownerSellerId !== sellerId)
    return { ok: false, error: "You do not own this manufacturer request." };
  if (manufacturer.status !== "PENDING" && manufacturer.status !== "REJECTED") {
    return { ok: false, error: "Only a pending or rejected request can be edited." };
  }
  return { ok: true };
}
