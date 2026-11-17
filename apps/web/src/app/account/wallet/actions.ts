"use server";

import { revalidatePath } from "next/cache";
import { createWalletTopupOrder, completeWalletTopup } from "@kisan4u/orders";
import {
  walletTopupOrderInputSchema,
  walletTopupVerifyInputSchema,
} from "@kisan4u/validators";
import { requireBuyerContext } from "@/lib/buyer-context";

type CreateResult =
  | { ok: true; topupId: string; razorpayOrderId: string; amountPaise: number; keyId: string }
  | { ok: false; error: string };

type VerifyResult = { ok: true; balance: number } | { ok: false; error: string };

/** Step 1: create the Razorpay order the wallet top-up widget pays against. */
export async function createWalletTopupOrderAction(rawInput: unknown): Promise<CreateResult> {
  const ctx = await requireBuyerContext();
  if (ctx.isGuest) return { ok: false, error: "Please sign in to add money to your wallet." };

  const parsed = walletTopupOrderInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid amount." };

  return createWalletTopupOrder(ctx.userId, ctx.role, parsed.data.amount);
}

/** Step 2: confirm the captured payment and credit the wallet. */
export async function verifyWalletTopupAction(rawInput: unknown): Promise<VerifyResult> {
  await requireBuyerContext();
  const parsed = walletTopupVerifyInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Invalid verification payload." };

  const result = await completeWalletTopup(parsed.data);
  if (result.ok) revalidatePath("/account/wallet");
  return result;
}
