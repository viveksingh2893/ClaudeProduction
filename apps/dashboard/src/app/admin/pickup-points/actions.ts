"use server";

import { revalidatePath } from "next/cache";
import {
  decidePickupPoint,
  adminCreatePickupPoint,
  adminUpdatePickupPoint,
  adminSyncPickupPointToCouriers,
} from "@kisan4u/orders";
import {
  adminPickupPointInputSchema,
  pickupPointDecisionInputSchema,
} from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true; warning?: string } | { ok: false; error: string };

export async function decidePickupPointAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = pickupPointDecisionInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await decidePickupPoint(parsed.data);
  if (result.ok) revalidatePath("/admin/pickup-points");
  return result;
}

/** Re-registers an approved pickup point on RapidShyp and every Delhivery account. */
export async function syncPickupPointToCouriersAction(pickupPointId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  if (typeof pickupPointId !== "string" || !pickupPointId) return { ok: false, error: "Invalid input" };

  const result = await adminSyncPickupPointToCouriers(pickupPointId);
  revalidatePath("/admin/pickup-points");
  return result;
}

/**
 * One action for both "add a pickup point on a seller's behalf" (no `id`)
 * and "edit an existing pickup point" (`id` present). Admin-only; seller
 * ownership is fixed by `sellerId` on create and never changes on edit.
 */
export async function saveAdminPickupPointAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = adminPickupPointInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { sellerId, approveNow, id, ...fields } = parsed.data;
  const result = id
    ? await adminUpdatePickupPoint(id, fields)
    : await adminCreatePickupPoint(sellerId, fields, { approveNow });

  if (result.ok) revalidatePath("/admin/pickup-points");
  return result.ok ? { ok: true, warning: result.warning } : result;
}
