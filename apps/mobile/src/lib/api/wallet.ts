import { api } from "@/lib/api-client";

export type WalletTransactionRow = {
  id: string;
  type: "CREDIT" | "DEBIT";
  reason: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
};

export type WalletSummary = { balance: number; recent: WalletTransactionRow[] };

export function getWallet() {
  return api.get<WalletSummary>("/api/mobile/v1/wallet");
}

/** Step 1 of a Razorpay wallet top-up: create the order the Checkout sheet pays against. */
export function createWalletTopupOrder(amount: number) {
  return api.post<{
    topupId: string;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
  }>("/api/mobile/v1/wallet/topup/razorpay", { amount });
}

/** Step 2: confirm the captured payment and credit the wallet. */
export function verifyWalletTopup(input: {
  topupId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  return api.post<{ balance: number }>("/api/mobile/v1/wallet/topup/razorpay/verify", input);
}
