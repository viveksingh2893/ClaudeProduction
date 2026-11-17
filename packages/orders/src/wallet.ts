import { prisma, type WalletOwnerType, type UserRole } from "@kisan4u/db";
import {
  razorpayCreateOrder,
  razorpayFetchPayment,
  toPaise,
  verifyPaymentSignature,
} from "@kisan4u/providers";
import { round2 } from "./money";
import { writeAuditLog } from "./audit";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/** Kisan4U Wallet is keyed by ownerId = User.id for both CUSTOMER and DEALER — a dealer's User row is the same one their DealerProfile references, so this stays a single wallet per person, not per role. */
export function walletOwnerTypeForRole(role: "CUSTOMER" | "DEALER"): WalletOwnerType {
  return role === "DEALER" ? "DEALER" : "CUSTOMER";
}

/**
 * Lazily provisions a zero-balance Wallet the first time anyone looks for
 * one — no separate "wallet signup" step exists (or is needed) for either
 * a customer or an approved dealer; the wallet simply exists with ₹0 once
 * first touched. Idempotent under a unique-constraint race (two concurrent
 * first-touches) by re-reading on conflict rather than throwing.
 */
export async function getOrCreateWallet(tx: TxClient, userId: string, role: "CUSTOMER" | "DEALER") {
  const existing = await tx.wallet.findUnique({ where: { ownerId: userId } });
  if (existing) return existing;
  try {
    return await tx.wallet.create({
      data: { ownerType: walletOwnerTypeForRole(role), ownerId: userId, balance: 0 },
    });
  } catch {
    return await tx.wallet.findUniqueOrThrow({ where: { ownerId: userId } });
  }
}

/** Current wallet balance without provisioning a wallet as a side effect (0 when none exists yet). Only ever used to PLAN a checkout before its transaction starts — what is actually debited is still decided by applyWalletAmount, from a fresh read inside the transaction. */
export async function peekWalletBalance(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUnique({ where: { ownerId: userId } });
  return wallet ? Number(wallet.balance) : 0;
}

export type WalletSummary = {
  balance: number;
  /** Dealer-only reward points balance — always 0 for a customer wallet (the earning scheme never touches it). See packages/orders/src/loyalty-points.ts. */
  loyaltyPoints: number;
  recent: {
    id: string;
    type: "CREDIT" | "DEBIT";
    reason: string;
    amount: number;
    balanceAfter: number;
    createdAt: Date;
  }[];
};

/** Read-only balance + recent ledger for account/checkout screens and admin/seller order views — never used to decide how much can be applied at checkout (that re-reads the balance fresh, inside the checkout transaction, see applyWalletAmount below). */
export async function getWalletSummary(
  userId: string,
  role: "CUSTOMER" | "DEALER",
): Promise<WalletSummary> {
  const wallet = await getOrCreateWallet(prisma, userId, role);
  const recent = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return {
    balance: Number(wallet.balance),
    loyaltyPoints: wallet.loyaltyPoints,
    recent: recent.map((t) => ({
      id: t.id,
      type: t.type,
      reason: t.reason,
      amount: Number(t.amount),
      balanceAfter: Number(t.balanceAfter),
      createdAt: t.createdAt,
    })),
  };
}

/**
 * Debits at most min(requestedAmount, current balance, eligibleCap) from
 * the wallet, inside the caller's transaction — eligibleCap is the
 * "amount payable now" for whatever payment plan was chosen (the
 * advance amount for ONLINE_PARTIAL, the full grand total for
 * ONLINE_FULL/TRANSPORT_FULL_ONLINE), which is exactly the "wallet
 * contributes only according to the existing upfront-payment rules /
 * wallet plus remaining online payment must cover the complete prepaid
 * amount" requirement — the caller never needs to branch on payment
 * method to compute this cap, it's already baked into eligibleCap.
 * Never trusts requestedAmount alone as authoritative; always re-reads
 * the live balance inside the same transaction as the rest of checkout.
 */
export async function applyWalletAmount(
  tx: TxClient,
  params: {
    userId: string;
    role: "CUSTOMER" | "DEALER";
    requestedAmount: number;
    eligibleCap: number;
    referenceId: string;
  },
): Promise<{ applied: number; walletId: string | null }> {
  const requested = round2(Math.max(0, params.requestedAmount));
  if (requested <= 0 || params.eligibleCap <= 0) return { applied: 0, walletId: null };

  const wallet = await getOrCreateWallet(tx, params.userId, params.role);
  const applied = round2(Math.min(requested, Number(wallet.balance), params.eligibleCap));
  if (applied <= 0) return { applied: 0, walletId: wallet.id };

  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { decrement: applied } },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "DEBIT",
      reason: "ORDER_PAYMENT",
      amount: applied,
      balanceAfter: updated.balance,
      referenceType: "order",
      referenceId: params.referenceId,
    },
  });
  return { applied, walletId: wallet.id };
}

/** Reverses a wallet debit that was just applied in the same transaction, for the "the rest of the payment failed" path — credits the exact amount straight back, no separate approval step (nothing external was ever charged; this is purely an internal ledger entry). */
export async function reverseWalletAmount(
  tx: TxClient,
  params: { walletId: string; amount: number; referenceId: string },
): Promise<void> {
  if (params.amount <= 0) return;
  const updated = await tx.wallet.update({
    where: { id: params.walletId },
    data: { balance: { increment: params.amount } },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: params.walletId,
      type: "CREDIT",
      reason: "REFUND_CREDIT",
      amount: params.amount,
      balanceAfter: updated.balance,
      referenceType: "order",
      referenceId: params.referenceId,
    },
  });
}

/** Credits a previously-successful wallet-funded amount back on order cancellation — a separate path from reverseWalletAmount (which only ever fires within the original checkout attempt, before anything else observed the debit). Caller is responsible for the walletRefunded idempotency check on the PaymentAllocation row. */
export async function refundWalletAmount(
  tx: TxClient,
  params: { userId: string; amount: number; referenceId: string },
): Promise<void> {
  if (params.amount <= 0) return;
  const wallet = await tx.wallet.findUnique({ where: { ownerId: params.userId } });
  if (!wallet) return;
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { increment: params.amount } },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "CREDIT",
      reason: "REFUND_CREDIT",
      amount: params.amount,
      balanceAfter: updated.balance,
      referenceType: "order",
      referenceId: params.referenceId,
    },
  });
}

export const WALLET_TOPUP_MIN = 1;
export const WALLET_TOPUP_MAX = 50000;

export type WalletTopupResult = { ok: true; balance: number } | { ok: false; error: string };

/**
 * The one place a wallet balance is credited from an "add money" flow
 * (Razorpay top-up or an admin manual credit) — always a balance
 * increment paired with a single CREDIT WalletTransaction, same discipline
 * applyWalletAmount follows for debits. Returns the ledger row id so a
 * caller (WalletTopup) can pin its idempotency reference to it.
 */
async function creditWalletBalance(
  tx: TxClient,
  params: {
    userId: string;
    role: "CUSTOMER" | "DEALER";
    amount: number;
    reason: "WALLET_TOPUP" | "ADMIN_CREDIT";
    referenceType: string;
    referenceId?: string;
  },
): Promise<{ walletTransactionId: string; balance: number }> {
  const wallet = await getOrCreateWallet(tx, params.userId, params.role);
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { increment: params.amount } },
  });
  const ledger = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "CREDIT",
      reason: params.reason,
      amount: params.amount,
      balanceAfter: updated.balance,
      referenceType: params.referenceType,
      referenceId: params.referenceId ?? null,
    },
  });
  return { walletTransactionId: ledger.id, balance: Number(updated.balance) };
}

function validateTopupAmount(amount: number): { ok: true; rounded: number } | { ok: false; error: string } {
  const rounded = round2(amount);
  if (!(rounded >= WALLET_TOPUP_MIN))
    return { ok: false, error: `Enter an amount of at least ₹${WALLET_TOPUP_MIN}.` };
  if (rounded > WALLET_TOPUP_MAX)
    return { ok: false, error: `Top-up amount cannot exceed ₹${WALLET_TOPUP_MAX.toLocaleString("en-IN")}.` };
  return { ok: true, rounded };
}

export type CreateWalletTopupOrderResult =
  | { ok: true; topupId: string; razorpayOrderId: string; amountPaise: number; keyId: string }
  | { ok: false; error: string };

/**
 * Step 1 of a self-service Razorpay wallet top-up: records a PENDING
 * WalletTopup and opens the Razorpay order the client's Checkout widget
 * pays against. Nothing is credited here — completeWalletTopup (client
 * callback, signature-verified) or completeWalletTopupByRazorpayOrderId
 * (payment.captured webhook) does that, whichever lands first.
 */
export async function createWalletTopupOrder(
  userId: string,
  role: "CUSTOMER" | "DEALER",
  amount: number,
): Promise<CreateWalletTopupOrderResult> {
  const amountCheck = validateTopupAmount(amount);
  if (!amountCheck.ok) return amountCheck;

  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) return { ok: false, error: "Online wallet top-up isn't available right now." };

  const topup = await prisma.walletTopup.create({
    data: {
      ownerId: userId,
      ownerType: walletOwnerTypeForRole(role),
      amount: amountCheck.rounded,
      status: "PENDING",
      provider: "RAZORPAY",
    },
  });

  let order;
  try {
    order = await razorpayCreateOrder({
      amountRupees: amountCheck.rounded,
      receipt: `WALLET-TOPUP-${topup.id}`,
      notes: { kind: "wallet_topup", topupId: topup.id, ownerId: userId },
    });
  } catch {
    await prisma.walletTopup.update({ where: { id: topup.id }, data: { status: "FAILED" } });
    return { ok: false, error: "Online wallet top-up isn't available right now." };
  }
  if (!order.ok) {
    await prisma.walletTopup.update({ where: { id: topup.id }, data: { status: "FAILED" } });
    return { ok: false, error: `Razorpay: ${order.error}` };
  }

  await prisma.walletTopup.update({
    where: { id: topup.id },
    data: { razorpayOrderId: order.data.id },
  });

  return {
    ok: true,
    topupId: topup.id,
    razorpayOrderId: order.data.id,
    amountPaise: order.data.amount,
    keyId,
  };
}

/** Credits the wallet for a captured top-up exactly once. Idempotent: a second call (webhook after client callback, or vice-versa) returns ok with the current balance and does nothing. */
async function creditTopupOnce(
  topupId: string,
  razorpayPaymentId: string,
): Promise<WalletTopupResult> {
  return prisma.$transaction(async (tx) => {
    // Claim the row: only the caller that flips PENDING -> PAID credits.
    const claimed = await tx.walletTopup.updateMany({
      where: { id: topupId, status: "PENDING" },
      data: { status: "PAID", razorpayPaymentId, completedAt: new Date() },
    });
    const topup = await tx.walletTopup.findUnique({ where: { id: topupId } });
    if (!topup) return { ok: false, error: "Top-up not found." };

    if (claimed.count === 0) {
      // Already completed by the other path (or FAILED). Report the live balance.
      const wallet = await getOrCreateWallet(
        tx,
        topup.ownerId,
        topup.ownerType === "DEALER" ? "DEALER" : "CUSTOMER",
      );
      return topup.status === "PAID"
        ? { ok: true, balance: Number(wallet.balance) }
        : { ok: false, error: "This top-up can no longer be completed." };
    }

    const credit = await creditWalletBalance(tx, {
      userId: topup.ownerId,
      role: topup.ownerType === "DEALER" ? "DEALER" : "CUSTOMER",
      amount: Number(topup.amount),
      reason: "WALLET_TOPUP",
      referenceType: "wallet_topup",
      referenceId: topup.id,
    });
    await tx.walletTopup.update({
      where: { id: topup.id },
      data: { walletTransactionId: credit.walletTransactionId },
    });
    return { ok: true, balance: credit.balance };
  });
}

/**
 * Step 2 (client callback): the Checkout widget's success handler hands
 * back {order_id, payment_id, signature}. Signature proves it came from
 * Razorpay; the live razorpayFetchPayment then proves the payment is
 * genuinely "captured" and for the right amount before any credit.
 */
export async function completeWalletTopup(input: {
  topupId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<WalletTopupResult> {
  const topup = await prisma.walletTopup.findUnique({ where: { id: input.topupId } });
  if (!topup) return { ok: false, error: "Top-up not found." };
  if (topup.razorpayOrderId !== input.razorpayOrderId) {
    return { ok: false, error: "This payment doesn't match that top-up." };
  }
  if (
    !verifyPaymentSignature({
      orderId: input.razorpayOrderId,
      paymentId: input.razorpayPaymentId,
      signature: input.razorpaySignature,
    })
  ) {
    return { ok: false, error: "Payment signature check failed." };
  }

  const fetched = await razorpayFetchPayment(input.razorpayPaymentId);
  if (!fetched.ok) return { ok: false, error: `Razorpay: ${fetched.error}` };
  if (fetched.data.status !== "captured") {
    return { ok: false, error: "Payment isn't captured yet. It will complete shortly." };
  }
  if (fetched.data.orderId && fetched.data.orderId !== input.razorpayOrderId) {
    return { ok: false, error: "This payment belongs to a different order." };
  }
  if (fetched.data.amount < toPaise(Number(topup.amount))) {
    return { ok: false, error: "The captured amount is less than the top-up amount." };
  }

  return creditTopupOnce(input.topupId, input.razorpayPaymentId);
}

/**
 * Webhook path (payment.captured) — the durable completion, independent of
 * the browser ever coming back. Signature is already verified by the
 * webhook route; a no-op when the order id isn't one of ours.
 */
export async function completeWalletTopupByRazorpayOrderId(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<void> {
  const topup = await prisma.walletTopup.findUnique({ where: { razorpayOrderId } });
  if (!topup || topup.status !== "PENDING") return;

  const fetched = await razorpayFetchPayment(razorpayPaymentId);
  if (!fetched.ok || fetched.data.status !== "captured") return;
  if (fetched.data.amount < toPaise(Number(topup.amount))) return;

  await creditTopupOnce(topup.id, razorpayPaymentId);
}

export type AdminCreditWalletResult =
  | { ok: true; balance: number }
  | { ok: false; error: string };

/**
 * Admin adds money to a customer's / dealer's wallet by hand from their
 * detail page — no payment gateway (goodwill credit, an offline payment
 * being recorded, a support adjustment). Writes a CREDIT ledger row with
 * reason ADMIN_CREDIT plus an audit-log entry naming the acting admin.
 */
export async function adminCreditWallet(params: {
  userId: string;
  role: "CUSTOMER" | "DEALER";
  amount: number;
  note?: string;
  actor: { id: string; role: UserRole };
}): Promise<AdminCreditWalletResult> {
  const amountCheck = validateTopupAmount(params.amount);
  if (!amountCheck.ok) return amountCheck;

  const target = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true } });
  if (!target) return { ok: false, error: "User not found." };

  const result = await prisma.$transaction((tx) =>
    creditWalletBalance(tx, {
      userId: params.userId,
      role: params.role,
      amount: amountCheck.rounded,
      reason: "ADMIN_CREDIT",
      referenceType: "admin_credit",
      referenceId: params.actor.id,
    }),
  );

  await writeAuditLog({
    actorId: params.actor.id,
    actorRole: params.actor.role,
    action: "WALLET_ADMIN_CREDIT",
    entityType: "Wallet",
    entityId: params.userId,
    metadata: { amount: amountCheck.rounded, role: params.role },
    reason: params.note?.trim() || undefined,
  });

  return { ok: true, balance: result.balance };
}

/**
 * Credits a wallet top-up once the (mock) payment provider confirms the
 * charge succeeded — mirrors checkout's own mockPaymentProvider usage so
 * "add money to wallet" is charged through the exact same simulated
 * gateway as an order payment, not a separate invented flow. Demo/dev
 * only, same as the rest of this codebase's payment provider.
 */
export async function topUpWallet(
  userId: string,
  role: "CUSTOMER" | "DEALER",
  amount: number,
  devSimulate?: "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "PENDING",
): Promise<WalletTopupResult> {
  const rounded = round2(amount);
  if (!(rounded > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (rounded > WALLET_TOPUP_MAX)
    return { ok: false, error: `Top-up amount cannot exceed ₹${WALLET_TOPUP_MAX}.` };

  const { mockPaymentProvider } = await import("@kisan4u/providers");
  const charge = await mockPaymentProvider.charge(
    {
      internalReference: `WALLET-TOPUP-${userId}-${Date.now()}`,
      customerId: userId,
      method: "ONLINE_FULL",
      amount: rounded,
    },
    devSimulate,
  );
  if (charge.outcome !== "SUCCESS") {
    return { ok: false, error: "Top-up payment did not succeed. Please try again." };
  }

  const wallet = await prisma.$transaction(async (tx) => {
    const w = await getOrCreateWallet(tx, userId, role);
    const updated = await tx.wallet.update({
      where: { id: w.id },
      data: { balance: { increment: rounded } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: w.id,
        type: "CREDIT",
        reason: "WALLET_TOPUP",
        amount: rounded,
        balanceAfter: updated.balance,
        referenceType: "wallet_topup",
        referenceId: charge.providerReference,
      },
    });
    return updated;
  });

  return { ok: true, balance: Number(wallet.balance) };
}
