"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session-guard";
import {
  buildBaSettlementBatch,
  markBaSettlementPaid,
  discardBaSettlementBatch,
} from "@kisan4u/orders";

type Result = { ok: true } | { ok: false; error: string };

export async function buildBaBatchAction(baId: string, month: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  const res = await buildBaSettlementBatch(baId, month);
  if (res.ok) revalidatePath("/admin/ba-settlements");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function markBaBatchPaidAction(settlementId: string, note?: string): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const res = await markBaSettlementPaid(settlementId, session.user.id, note);
  if (res.ok) revalidatePath("/admin/ba-settlements");
  return res;
}

export async function discardBaBatchAction(settlementId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  const res = await discardBaSettlementBatch(settlementId);
  if (res.ok) revalidatePath("/admin/ba-settlements");
  return res;
}
