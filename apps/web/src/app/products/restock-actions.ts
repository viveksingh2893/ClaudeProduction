"use server";

import { revalidatePath } from "next/cache";
import { subscribeToRestock, cancelRestockSubscription, type StockTarget } from "@kisan4u/catalog";
import { requireBuyerContext } from "@/lib/buyer-context";

type Result = { ok: true; subscriptionId: string } | { ok: false; error: string };

/**
 * spec §9 "Notify me when stock is available". requireBuyerContext throws
 * a Next.js redirect() for a signed-out visitor — safe to call directly
 * from a client component's Server Action invocation (see
 * lib/session-guard.ts's doc comment); the browser is simply navigated to
 * /login, satisfying "ask them to sign in" without any special handling
 * here. This app's login flow has no return-URL support yet (verified —
 * no callbackUrl/next param exists anywhere in app/login), so the visitor
 * is not returned to this exact product afterward; a known, reported
 * limitation rather than a new auth feature built for this task.
 */
export async function subscribeToRestockAction(target: StockTarget): Promise<Result> {
  const ctx = await requireBuyerContext();
  const result = await subscribeToRestock(ctx.userId, target);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return { ok: true, subscriptionId: result.subscriptionId };
}

export async function cancelRestockSubscriptionAction(
  subscriptionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireBuyerContext();
  return cancelRestockSubscription(ctx.userId, subscriptionId);
}
