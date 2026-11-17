"use server";

import { revalidatePath } from "next/cache";
import { savePosPricingConfig } from "@kisan4u/orders";
import { posPricingConfigInputSchema } from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The PosPricingConfig singleton — read fresh (never cached) by
 * checkout-draft.ts on every POS customer checkout/preview, so a save
 * here takes effect on the very next order with nothing further to
 * invalidate; revalidatePath is only for this admin page's own display.
 */
export async function savePosPricingConfigAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = posPricingConfigInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await savePosPricingConfig(parsed.data);
  revalidatePath("/admin/pos/pricing");
  return { ok: true };
}
