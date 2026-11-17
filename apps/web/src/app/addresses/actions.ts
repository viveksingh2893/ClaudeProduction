"use server";

import { revalidatePath } from "next/cache";
import { createAddress, updateAddress, deleteAddress, setDefaultAddress } from "@kisan4u/orders";
import { customerAddressInputSchema } from "@kisan4u/validators";
import { requireBuyerContext } from "@/lib/buyer-context";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A dealer's state is always forced to their own verified state (never
 * the submitted form value) — see @kisan4u/orders' createAddress/
 * updateAddress, which apply `dealerLock` regardless of what `input.state`/
 * `input.stateId` contain (Phase 4 spec §C2).
 */
export async function saveAddressAction(rawInput: unknown): Promise<Result> {
  const ctx = await requireBuyerContext();
  const parsed = customerAddressInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const dealerLock = ctx.role === "DEALER" ? ctx.dealerState : null;
  const result = parsed.data.id
    ? await updateAddress(ctx.userId, dealerLock, parsed.data)
    : await createAddress(ctx.userId, dealerLock, parsed.data);

  if (result.ok) revalidatePath("/addresses");
  return result.ok ? { ok: true } : result;
}

export async function deleteAddressAction(addressId: string): Promise<Result> {
  const ctx = await requireBuyerContext();
  const result = await deleteAddress(ctx.userId, addressId);
  if (result.ok) revalidatePath("/addresses");
  return result.ok ? { ok: true } : result;
}

export async function setDefaultAddressAction(addressId: string): Promise<Result> {
  const ctx = await requireBuyerContext();
  const result = await setDefaultAddress(ctx.userId, addressId);
  if (result.ok) revalidatePath("/addresses");
  return result.ok ? { ok: true } : result;
}
