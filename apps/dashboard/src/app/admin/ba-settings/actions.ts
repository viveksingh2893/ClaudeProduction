"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session-guard";
import {
  saveBaSettings,
  saveBaRateConfig,
  setBaRateConfigActive,
  setBaProgramEnabled,
} from "@kisan4u/orders";
import { baSettingsSchema, baRateConfigSchema } from "@kisan4u/validators";

type Result = { ok: true } | { ok: false; error: string };

export async function saveBaSettingsAction(raw: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = baSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveBaSettings(parsed.data);
  revalidatePath("/admin/ba-settings");
  return { ok: true };
}

export async function saveBaRateConfigAction(raw: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = baRateConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveBaRateConfig({ ...parsed.data, isDemo: false });
  revalidatePath("/admin/ba-settings");
  return { ok: true };
}

export async function toggleBaRateConfigAction(id: string, isActive: boolean): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setBaRateConfigActive(id, isActive);
  revalidatePath("/admin/ba-settings");
  return { ok: true };
}

export async function toggleBaProgramAction(enabled: boolean): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setBaProgramEnabled(enabled);
  revalidatePath("/admin/ba-settings");
  revalidatePath("/admin");
  return { ok: true };
}
