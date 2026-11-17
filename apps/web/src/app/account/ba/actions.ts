"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  submitBaForm1,
  submitBaForm2,
  createProposedOrder,
  decideProposedOrder,
  clearCart,
} from "@kisan4u/orders";
import {
  baForm1Schema,
  baForm2Schema,
  proposedOrderCreateSchema,
  proposedOrderDecisionSchema,
} from "@kisan4u/validators";

type Result = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function submitBaForm1Action(raw: unknown): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Please sign in again." };
  const parsed = baForm1Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await submitBaForm1(userId, parsed.data);
  if (res.ok) revalidatePath("/account/ba");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function submitBaForm2Action(raw: unknown): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Please sign in again." };
  const parsed = baForm2Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await submitBaForm2(userId, parsed.data);
  if (res.ok) revalidatePath("/account/ba");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function createProposedOrderAction(raw: unknown): Promise<Result & { proposedOrderId?: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Please sign in again." };
  const parsed = proposedOrderCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await createProposedOrder(userId, parsed.data);
  if (res.ok) {
    // Only meaningful when this was called from checkout with the buyer's
    // real cart lines (see checkout-form.tsx) — a no-op clear otherwise.
    await clearCart(userId).catch(() => {});
    revalidatePath("/account/ba");
  }
  return res.ok
    ? { ok: true, proposedOrderId: res.proposedOrderId }
    : { ok: false, error: res.error };
}

export async function decideProposedOrderAction(raw: unknown): Promise<Result & { checkoutGroupId?: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Please sign in again." };
  const parsed = proposedOrderDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await decideProposedOrder(userId, parsed.data.proposedOrderId, parsed.data.decision);
  if (res.ok) {
    revalidatePath("/account/ba");
    revalidatePath(`/account/ba/orders/${parsed.data.proposedOrderId}`);
  }
  return res.ok
    ? { ok: true, checkoutGroupId: res.checkoutGroupId }
    : { ok: false, error: res.error };
}
