import { prisma, type Prisma, type UserRole } from "@kisan4u/db";
import { resolveReturnWindowMs } from "../settlement-rates";

type DbClient = typeof prisma | Prisma.TransactionClient;

export type AccountDeletionBlocker = {
  code: string;
  message: string;
  count?: number;
};

export type AccountDeletionEligibility = {
  eligible: boolean;
  requiresManualReview: boolean;
  blockers: AccountDeletionBlocker[];
  warnings: string[];
  role: UserRole;
  walletBalance: number;
};

const TERMINAL_ORDER_STATUSES = [
  "CANCELLED",
  "CLOSED",
  "REFUND_COMPLETED",
  "RTO_DELIVERED_TO_SELLER",
  "DELIVERED",
] as const;

export async function getAccountDeletionEligibility(
  userId: string,
  db: DbClient = prisma,
): Promise<AccountDeletionEligibility | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, baProfile: { select: { id: true } } },
  });
  if (!user) return null;

  const blockers: AccountDeletionBlocker[] = [];
  const warnings = [
    "Orders, payments, refunds and invoices are retained for the legally required period.",
    "Your readable phone number and email address will be removed after deletion.",
  ];

  if (["ADMIN", "STAFF", "DELIVERY_MAN"].includes(user.role)) {
    blockers.push({
      code: "ROLE_NOT_ELIGIBLE",
      message: "This account type cannot be deleted through self-service.",
    });
  }

  const [
    openOrders,
    deliveredOrders,
    openRefunds,
    unpaidPayments,
    pendingTopups,
    wallet,
    pendingWithdrawals,
  ] = await Promise.all([
    db.sellerOrder.count({
      where: { customerId: userId, status: { notIn: [...TERMINAL_ORDER_STATUSES] } },
    }),
    db.sellerOrder.findMany({
      where: { customerId: userId, status: "DELIVERED" },
      select: {
        id: true,
        statusHistory: {
          where: { status: "DELIVERED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    db.refundRequest.count({
      where: { customerId: userId, status: { in: ["PENDING", "APPROVED"] } },
    }),
    db.payment.count({
      where: {
        customerId: userId,
        status: { in: ["PENDING", "PARTIALLY_PAID", "REFUND_PENDING"] },
        allocations: { some: { sellerOrder: { status: { notIn: [...TERMINAL_ORDER_STATUSES] } } } },
      },
    }),
    db.walletTopup.count({ where: { ownerId: userId, status: "PENDING" } }),
    db.wallet.findUnique({
      where: { ownerId: userId },
      select: { balance: true, pendingWithdraw: true },
    }),
    db.withdrawRequest.count({
      where: { ownerId: userId, status: { in: ["PENDING", "APPROVED"] } },
    }),
  ]);

  if (openOrders > 0)
    blockers.push({
      code: "OPEN_ORDERS",
      message: "Complete or cancel active orders first.",
      count: openOrders,
    });

  const returnWindowMs = await resolveReturnWindowMs();
  const deliveredInsideWindow = deliveredOrders.filter((order) => {
    const deliveredAt = order.statusHistory[0]?.createdAt;
    return !deliveredAt || Date.now() <= deliveredAt.getTime() + returnWindowMs;
  }).length;
  if (deliveredInsideWindow > 0) {
    blockers.push({
      code: "RETURN_WINDOW_OPEN",
      message: "Wait until the return window closes for delivered orders.",
      count: deliveredInsideWindow,
    });
  }
  if (openRefunds > 0)
    blockers.push({
      code: "OPEN_REFUNDS",
      message: "Resolve pending refunds first.",
      count: openRefunds,
    });
  if (unpaidPayments > 0)
    blockers.push({
      code: "UNPAID_BALANCE",
      message: "An order still has an unpaid or partially paid balance.",
      count: unpaidPayments,
    });
  if (pendingTopups > 0)
    blockers.push({
      code: "PENDING_WALLET_TOPUP",
      message: "A wallet top-up is still pending.",
      count: pendingTopups,
    });
  const walletBalance = wallet ? Number(wallet.balance) : 0;
  if (walletBalance > 0) {
    warnings.push(
      `Your wallet contains ₹${walletBalance.toFixed(2)}. Use it before requesting deletion or confirm that the remaining balance will be forfeited.`,
    );
  }
  if ((wallet && Number(wallet.pendingWithdraw) > 0) || pendingWithdrawals > 0) {
    blockers.push({ code: "PENDING_WITHDRAWAL", message: "A wallet withdrawal is still pending." });
  }

  if (user.baProfile) {
    const [earnings, settlements] = await Promise.all([
      db.baEarning.count({
        where: { baId: user.baProfile.id, status: { in: ["LOCKED", "ELIGIBLE"] } },
      }),
      db.baSettlement.count({ where: { baId: user.baProfile.id, status: "PENDING" } }),
    ]);
    if (earnings + settlements > 0) {
      blockers.push({
        code: "UNSETTLED_BA_EARNINGS",
        message: "Business Associate earnings must be settled first.",
        count: earnings + settlements,
      });
    }
  }

  const requiresManualReview = user.role === "SELLER" || Boolean(user.baProfile);
  if (requiresManualReview)
    warnings.push("This request requires administrator review before deletion is scheduled.");

  return {
    eligible: blockers.length === 0,
    requiresManualReview,
    blockers,
    warnings,
    role: user.role,
    walletBalance,
  };
}
