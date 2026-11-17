"use server";

import { saveLogisticsConfig, type SlabInput } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function saveLogisticsConfigAction(
  configId: string | null,
  input: { maxWeightGrams: number; aboveMaxPrice: number; isActive: boolean; slabs: SlabInput[] },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const result = await saveLogisticsConfig(configId, input);
  if (!result.ok) return result;
  return { ok: true };
}
