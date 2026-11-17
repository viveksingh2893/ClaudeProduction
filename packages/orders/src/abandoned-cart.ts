import { prisma } from "@kisan4u/db";
import { notifyBuyer } from "./notifications";

/**
 * Abandoned-cart nudge: a buyer added something to their cart and never
 * made it to checkout. A periodic sweep (started from the web app's
 * instrumentation hook — see apps/web/src/instrumentation-node.ts) finds
 * those carts and sends the buyer one reminder notification + push.
 *
 * "Abandoned" = the cart's most recently touched line is between
 * `idleMinutes` and `staleDays` old (old enough that they've clearly
 * stopped, recent enough that the reminder is still relevant), the user is
 * a real (non-guest) account with at least one registered push device, and
 * they haven't already been reminded within `cooldownHours` (tracked by
 * the CartReminder row). Placing an order clears the cart, so a non-empty
 * cart is itself the "did not check out" signal.
 */

const DEFAULTS = {
  idleMinutes: 60,
  staleDays: 7,
  cooldownHours: 72,
  batchLimit: 200,
};

export type SweepAbandonedCartsResult = {
  scanned: number;
  reminded: number;
};

export async function sweepAbandonedCarts(
  opts: Partial<typeof DEFAULTS> = {},
): Promise<SweepAbandonedCartsResult> {
  const { idleMinutes, staleDays, cooldownHours, batchLimit } = { ...DEFAULTS, ...opts };
  const now = Date.now();
  const idleBefore = new Date(now - idleMinutes * 60_000);
  const staleAfter = new Date(now - staleDays * 24 * 60 * 60_000);
  const cooldownBefore = new Date(now - cooldownHours * 60 * 60_000);

  // Distinct users with at least one cart line touched in the eligible
  // window. Grouping by userId collapses multi-line carts to one candidate.
  const groups = await prisma.cartItem.groupBy({
    by: ["userId"],
    where: { updatedAt: { lt: idleBefore, gt: staleAfter } },
    _max: { updatedAt: true },
    orderBy: { _max: { updatedAt: "asc" } },
    take: batchLimit,
  });
  if (groups.length === 0) return { scanned: 0, reminded: 0 };

  const userIds = groups.map((g) => g.userId);

  const [users, devices, reminders] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, isGuest: false },
      select: { id: true, firstName: true },
    }),
    prisma.pushDevice.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
    }),
    prisma.cartReminder.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, lastRemindedAt: true },
    }),
  ]);

  const withDevice = new Set(devices.map((d) => d.userId));
  const remindedAt = new Map(reminders.map((r) => [r.userId, r.lastRemindedAt]));
  const nameById = new Map(users.map((u) => [u.id, u.firstName]));

  const eligible = users
    .map((u) => u.id)
    .filter((id) => withDevice.has(id))
    .filter((id) => {
      const last = remindedAt.get(id);
      return !last || last < cooldownBefore;
    });

  let reminded = 0;
  for (const userId of eligible) {
    const name = nameById.get(userId)?.trim();
    await notifyBuyer({
      customerId: userId,
      title: "You left something in your cart",
      body: name
        ? `${name}, your cart is waiting — complete your order before items sell out.`
        : "Your cart is waiting — complete your order before items sell out.",
      linkUrl: "/cart",
    });
    await prisma.cartReminder.upsert({
      where: { userId },
      create: { userId, lastRemindedAt: new Date() },
      update: { lastRemindedAt: new Date() },
    });
    reminded += 1;
  }

  return { scanned: groups.length, reminded };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the periodic sweep. Idempotent — a second call is a no-op so
 * Next's instrumentation firing twice (edge + node) can't double-schedule.
 * First pass is delayed 90s to stay clear of cold-start work.
 */
export function startAbandonedCartSweep(): void {
  if (sweepTimer) return;
  const run = () => {
    sweepAbandonedCarts().catch((error) => {
      console.error("[abandoned-cart] sweep failed", error);
    });
  };
  setTimeout(run, 90_000);
  sweepTimer = setInterval(run, 30 * 60_000);
}
