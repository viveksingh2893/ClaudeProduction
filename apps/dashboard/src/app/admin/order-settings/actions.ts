"use server";

import { revalidatePath } from "next/cache";
import {
  savePartialPaymentConfig,
  setPartialPaymentConfigActive,
  saveCollectionChargeConfig,
  setCollectionChargeConfigActive,
  saveSettlementRateConfig,
  setSettlementRateConfigActive,
} from "@kisan4u/orders";
import {
  partialPaymentConfigInputSchema,
  collectionChargeConfigInputSchema,
  settlementRateConfigInputSchema,
} from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function savePartialPaymentConfigAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = partialPaymentConfigInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await savePartialPaymentConfig(parsed.data);
  revalidatePath("/admin/order-settings");
  return { ok: true };
}

export async function togglePartialPaymentConfigAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setPartialPaymentConfigActive(id, isActive);
  revalidatePath("/admin/order-settings");
  return { ok: true };
}

export async function saveCollectionChargeConfigAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = collectionChargeConfigInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveCollectionChargeConfig(parsed.data);
  revalidatePath("/admin/order-settings");
  return { ok: true };
}

export async function toggleCollectionChargeConfigAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setCollectionChargeConfigActive(id, isActive);
  revalidatePath("/admin/order-settings");
  return { ok: true };
}

// --- Settlement tax rates (Business Settings) --------------------------------
// This first admin-UI pass only ever writes the global config (sellerId and
// customerType both null) — per-seller/per-customerType overrides remain
// possible at the service layer (packages/orders/src/settlement-rates.ts)
// for a future UI pass, but aren't exposed here.

export async function saveSettlementRateConfigAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = settlementRateConfigInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveSettlementRateConfig({
    ...parsed.data,
    sellerId: null,
    customerType: null,
    isDemo: false,
  });
  revalidatePath("/admin/order-settings");
  return { ok: true };
}

export async function toggleSettlementRateConfigAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setSettlementRateConfigActive(id, isActive);
  revalidatePath("/admin/order-settings");
  return { ok: true };
}
