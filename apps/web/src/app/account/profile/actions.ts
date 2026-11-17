"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@kisan4u/db";
import { updateProfileSchema } from "@kisan4u/validators";
import { setCustomerStateOnce, type CustomerStateResult } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";

type Result =
  | { ok: true; firstName: string; lastName: string | null }
  | { ok: false; error: string };

export async function updateProfileAction(rawInput: unknown): Promise<Result> {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  const parsed = updateProfileSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  const lastName = parsed.data.lastName?.trim() || null;

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { firstName: parsed.data.firstName, lastName },
  });

  revalidatePath("/account/profile");
  revalidatePath("/account");
  // firstName is required by updateProfileSchema, so it's never actually
  // null after this update — the `?? parsed.data.firstName` fallback is
  // just to satisfy the column's nullable DB type.
  return { ok: true, firstName: user.firstName ?? parsed.data.firstName, lastName: user.lastName };
}

/**
 * Customer self-service, one-time state selection (spec §1) — session's
 * own user id only, never a client-supplied target, so a manually
 * modified request can never target another account. The actual
 * once-only enforcement lives server-side in setCustomerStateOnce
 * (rejects if User.stateId is already non-null), not here or in the UI.
 */
export async function setCustomerStateAction(stateId: string): Promise<CustomerStateResult> {
  const session = await requireSession(["CUSTOMER"]);
  const result = await setCustomerStateOnce(session.user.id, stateId);
  if (result.ok) {
    // No unstable_cache layer sits in front of the customer catalogue
    // today (each page is a plain per-request DB read), so these are
    // defense-in-depth rather than strictly required — but explicit per
    // spec §1 ("invalidate customer catalogue caches").
    revalidatePath("/account/profile");
    revalidatePath("/products");
    revalidatePath("/wishlist");
    revalidatePath("/cart");
  }
  return result;
}
