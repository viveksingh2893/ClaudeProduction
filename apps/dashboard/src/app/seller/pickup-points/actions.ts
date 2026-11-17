"use server";

import { revalidatePath } from "next/cache";
import {
  createSellerPickupPoint,
  updateSellerPickupPoint,
  setSellerPickupPointActive,
} from "@kisan4u/orders";
import { sellerPickupPointInputSchema } from "@kisan4u/validators";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

type Result = { ok: true } | { ok: false; error: string };

/** Ownership is enforced inside create/update themselves (scoped by sellerProfileId) — §K2: a seller must not access or modify another seller's pickup points. */
export async function savePickupPointAction(rawInput: unknown): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const parsed = sellerPickupPointInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = parsed.data.id
    ? await updateSellerPickupPoint(sellerProfileId, parsed.data)
    : await createSellerPickupPoint(sellerProfileId, parsed.data);
  if (result.ok) revalidatePath("/seller/pickup-points");
  return result.ok ? { ok: true } : result;
}

export async function togglePickupPointActiveAction(
  pickupPointId: string,
  isActive: boolean,
): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const result = await setSellerPickupPointActive(sellerProfileId, pickupPointId, isActive);
  if (result.ok) revalidatePath("/seller/pickup-points");
  return result.ok ? { ok: true } : result;
}
