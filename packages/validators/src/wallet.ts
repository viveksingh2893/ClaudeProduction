import { z } from "zod";
import { mockPaymentSimulateEnum } from "./checkout";

/** Mirrors checkoutInputSchema's devSimulatePaymentOutcome — same manual-testing hook, reused here rather than duplicated, since wallet top-up goes through the same mock payment provider as an order payment. (Mobile app / legacy mock path only — the web app tops up via Razorpay, see below.) */
export const walletTopupInputSchema = z.object({
  amount: z.coerce.number().positive("Enter an amount greater than zero."),
  devSimulatePaymentOutcome: mockPaymentSimulateEnum.optional(),
});

export type WalletTopupInput = z.infer<typeof walletTopupInputSchema>;

/** Step 1 of the web Razorpay wallet top-up — just the amount; the server creates the Razorpay order. */
export const walletTopupOrderInputSchema = z.object({
  amount: z.coerce.number().positive("Enter an amount greater than zero."),
});
export type WalletTopupOrderInput = z.infer<typeof walletTopupOrderInputSchema>;

/** Step 2 — the Checkout widget's success payload, handed straight to completeWalletTopup. */
export const walletTopupVerifyInputSchema = z.object({
  topupId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type WalletTopupVerifyInput = z.infer<typeof walletTopupVerifyInputSchema>;

/** Admin "add money to this wallet" from the customer / dealer detail page — no gateway. */
export const adminWalletCreditInputSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().positive("Enter an amount greater than zero."),
  note: z.string().trim().max(300).optional(),
});
export type AdminWalletCreditInput = z.infer<typeof adminWalletCreditInputSchema>;
