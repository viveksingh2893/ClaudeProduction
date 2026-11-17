"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session-guard";
import { adminDecideBa, adminDecideBaBank, adminEditBa } from "@kisan4u/orders";
import { baAdminDecisionSchema, baAdminEditSchema, baBankDecisionSchema } from "@kisan4u/validators";

type Result = { ok: true } | { ok: false; error: string };

export async function decideBaAction(raw: unknown): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const parsed = baAdminDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const decisionMap = {
    APPROVE: "APPROVE",
    REJECT: "REJECT",
    SUSPEND: "SUSPEND",
    REINSTATE: "REINSTATE",
  } as const;
  const res = await adminDecideBa(
    session.user.id,
    parsed.data.baId,
    decisionMap[parsed.data.decision],
    parsed.data.reason || undefined,
  );
  if (res.ok) {
    revalidatePath("/admin/business-associates");
    revalidatePath(`/admin/business-associates/${parsed.data.baId}`);
  }
  return res;
}

export async function decideBaBankAction(raw: unknown): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const parsed = baBankDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await adminDecideBaBank(
    session.user.id,
    parsed.data.baId,
    parsed.data.decision,
    parsed.data.reason || undefined,
  );
  if (res.ok) {
    revalidatePath("/admin/business-associates");
    revalidatePath(`/admin/business-associates/${parsed.data.baId}`);
    revalidatePath("/admin/ba-settlements");
  }
  return res;
}

export async function editBaAction(raw: unknown): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const parsed = baAdminEditSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await adminEditBa(session.user.id, parsed.data);
  if (res.ok) revalidatePath(`/admin/business-associates/${parsed.data.baId}`);
  return res;
}
