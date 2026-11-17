"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@kisan4u/db";
import { couponInputSchema, couponUpdateSchema, couponToggleActiveSchema } from "@kisan4u/validators";
import { requireAdminPermission } from "@/lib/session-guard";
import { COUPONS_MODULE_KEY } from "@/lib/coupons-guard";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Coupons created through this admin module are always platform-wide
 * (bearer: "ADMIN", sellerId: null) — the SELLER-bearer path on the
 * Coupon model stays reserved/unused, out of scope for this module. See
 * apps/dashboard/src/lib/coupons-guard.ts and packages/db/prisma/seed.ts's
 * KNOWN_MODULES for why only the seeded Super Admin role reaches here.
 */
export async function createCouponAction(rawInput: unknown): Promise<Result> {
  await requireAdminPermission(COUPONS_MODULE_KEY, "CREATE");
  const parsed = couponInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await prisma.coupon.findUnique({ where: { code: parsed.data.code } });
  if (existing) return { ok: false, error: "A coupon with this code already exists." };

  await prisma.coupon.create({
    data: {
      code: parsed.data.code,
      bearer: "ADMIN",
      audience: parsed.data.audience,
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      minPurchase: parsed.data.minPurchase,
      maxDiscount: parsed.data.maxDiscount ?? null,
      usageLimit: parsed.data.usageLimit ?? null,
      perUserLimit: parsed.data.perUserLimit ?? null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      isActive: parsed.data.isActive,
    },
  });
  revalidatePath("/admin/coupons");
  return { ok: true };
}

export async function updateCouponAction(rawInput: unknown): Promise<Result> {
  await requireAdminPermission(COUPONS_MODULE_KEY, "EDIT");
  const parsed = couponUpdateSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await prisma.coupon.findUnique({
    where: { code: parsed.data.code },
    select: { id: true },
  });
  if (existing && existing.id !== parsed.data.id) {
    return { ok: false, error: "A coupon with this code already exists." };
  }

  await prisma.coupon.update({
    where: { id: parsed.data.id },
    data: {
      code: parsed.data.code,
      audience: parsed.data.audience,
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      minPurchase: parsed.data.minPurchase,
      maxDiscount: parsed.data.maxDiscount ?? null,
      usageLimit: parsed.data.usageLimit ?? null,
      perUserLimit: parsed.data.perUserLimit ?? null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      isActive: parsed.data.isActive,
    },
  });
  revalidatePath("/admin/coupons");
  return { ok: true };
}

/** Soft pause/resume only — redemption history (CouponRedemption rows) must survive, so there is deliberately no delete action. */
export async function toggleCouponActiveAction(rawInput: unknown): Promise<Result> {
  await requireAdminPermission(COUPONS_MODULE_KEY, "EDIT");
  const parsed = couponToggleActiveSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await prisma.coupon.update({
    where: { id: parsed.data.id },
    data: { isActive: parsed.data.isActive },
  });
  revalidatePath("/admin/coupons");
  return { ok: true };
}
