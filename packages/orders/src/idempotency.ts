import { prisma, Prisma } from "@kisan4u/db";

export type ClaimIdempotencyResult =
  | { ok: true; alreadyCompleted: false }
  | { ok: true; alreadyCompleted: true; checkoutGroupId: string }
  | { ok: false; error: string };

/**
 * The actual duplicate-submission guard for checkout (Phase 4 spec §D/§Z —
 * "prevent duplicate orders if the user refreshes or double-clicks Place
 * Order"). `key` is a client-generated, per-attempt token (see the
 * checkout page, which mints a fresh one on first render and reuses it
 * across retries of the SAME click, but a genuinely new click, e.g. after
 * a page refresh, mints a new one — see checkout.ts for how a fresh key on
 * a still-non-empty cart is otherwise harmless).
 *
 * Relies on `OrderIdempotencyKey.key`'s unique constraint: the INSERT
 * either succeeds (this is a brand-new attempt) or fails with a unique
 * violation (this exact key was already seen), which is the only reliable
 * way to do this under concurrent requests — checking-then-inserting
 * without the constraint would itself have a race window.
 */
export async function claimIdempotencyKey(
  key: string,
  userId: string,
): Promise<ClaimIdempotencyResult> {
  try {
    await prisma.orderIdempotencyKey.create({ data: { key, userId, status: "PENDING" } });
    return { ok: true, alreadyCompleted: false };
  } catch (error) {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!isUniqueViolation) throw error;

    const existing = await prisma.orderIdempotencyKey.findUnique({ where: { key } });
    if (!existing || existing.userId !== userId) {
      return { ok: false, error: "This request could not be processed." };
    }
    if (existing.status === "COMPLETED" && existing.checkoutGroupId) {
      return { ok: true, alreadyCompleted: true, checkoutGroupId: existing.checkoutGroupId };
    }

    // A PENDING row younger than this is a genuine in-flight request (a
    // real double-click / refresh race). Older than this it's a checkout
    // that died mid-run without ever reaching completeIdempotencyKey /
    // failIdempotencyKey (process killed, connection dropped) — the same
    // dead end as a FAILED row, so treat it the same: retryable.
    const STALE_PENDING_MS = 90_000;
    const isStalePending =
      existing.status === "PENDING" &&
      Date.now() - existing.updatedAt.getTime() > STALE_PENDING_MS;

    if (existing.status === "PENDING" && !isStalePending) {
      return {
        ok: false,
        error:
          "Your order is already being placed. Please wait a moment and check your orders before retrying.",
      };
    }

    // status === "FAILED", or a stale PENDING: the earlier attempt created
    // NOTHING (checkout() fails the whole thing atomically or not at all),
    // so the same key MUST be retryable — otherwise a one-off failure (a
    // transient DB hiccup, a since-fixed cart issue, a killed process)
    // permanently bricks that Place Order button and the shopper/operator
    // can only escape by starting a whole new order. Re-stamp the row to
    // PENDING atomically (guarded on the exact prior state) so two
    // concurrent retries still can't both proceed; the winner re-runs the
    // full re-validation in checkout() from scratch.
    const reclaimed = await prisma.orderIdempotencyKey.updateMany({
      where: { key, status: existing.status, updatedAt: existing.updatedAt },
      data: { status: "PENDING" },
    });
    if (reclaimed.count === 1) return { ok: true, alreadyCompleted: false };

    // Lost the race: another retry took the slot, or it just completed.
    const now = await prisma.orderIdempotencyKey.findUnique({ where: { key } });
    if (now?.status === "COMPLETED" && now.checkoutGroupId) {
      return { ok: true, alreadyCompleted: true, checkoutGroupId: now.checkoutGroupId };
    }
    return {
      ok: false,
      error:
        "Your order is already being placed. Please wait a moment and check your orders before retrying.",
    };
  }
}

export async function completeIdempotencyKey(key: string, checkoutGroupId: string): Promise<void> {
  await prisma.orderIdempotencyKey.update({
    where: { key },
    data: { status: "COMPLETED", checkoutGroupId },
  });
}

export async function failIdempotencyKey(key: string): Promise<void> {
  await prisma.orderIdempotencyKey
    .update({ where: { key }, data: { status: "FAILED" } })
    .catch(() => {
      // Best-effort only — if this row somehow doesn't exist, there is
      // nothing further to roll back.
    });
}
