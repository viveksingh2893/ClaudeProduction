import { prisma, getFullName } from "@kisan4u/db";
import { getWalletSummary } from "@kisan4u/orders";
import { Breadcrumbs, Card, PageContainer, PageHeader, SectionHeader } from "@kisan4u/ui";
import { requireBuyerContext } from "@/lib/buyer-context";
import { TopUpForm } from "./topup-form";

const TRANSACTION_LABEL: Record<string, string> = {
  ORDER_PAYMENT: "Applied to an order",
  REFUND_CREDIT: "Refunded from a cancelled order",
  WALLET_TOPUP: "Added to wallet",
  ADMIN_CREDIT: "Added by Kisan4U",
  ORDER_COMMISSION: "Order commission",
  ORDER_EARNING: "Order earning",
  DELIVERY_CHARGE: "Delivery charge",
  COD_COLLECTION: "COD collection",
  REFUND_DEBIT: "Refund debit",
  WITHDRAWAL: "Withdrawal",
  LOYALTY_BONUS: "Loyalty bonus",
  REFERRAL_COMMISSION: "Referral commission",
};

export default async function WalletPage() {
  const ctx = await requireBuyerContext();
  const [wallet, user] = await Promise.all([
    getWalletSummary(ctx.userId, ctx.role),
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, phone: true },
    }),
  ]);

  return (
    <PageContainer maxWidth="700px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs items={[{ label: "Account", href: "/account" }, { label: "Kisan4U Wallet" }]} />
      </div>
      <PageHeader title="Kisan4U Wallet" />

      <Card className="p-5">
        <div className="text-sm text-gray-600">Available balance</div>
        <div className="text-3xl font-extrabold text-green-800">₹{wallet.balance.toFixed(2)}</div>
      </Card>

      {ctx.role === "DEALER" && (
        <Card className="mt-4 p-5">
          <div className="text-sm text-gray-600">Loyalty points</div>
          <div className="text-3xl font-extrabold text-earth-700">{wallet.loyaltyPoints}</div>
          <p className="mt-1 text-xs text-gray-500">
            Earned on delivered orders. Not redeemable yet.
          </p>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <SectionHeader title="Add money" />
        <TopUpForm
          prefillName={(user ? getFullName(user) : null) ?? undefined}
          prefillContact={user?.phone ?? undefined}
        />
      </Card>

      <Card className="mt-4 p-5">
        <SectionHeader title="Recent activity" />
        {wallet.recent.length === 0 ? (
          <p className="text-sm text-gray-600">No wallet activity yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {wallet.recent.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-semibold text-ink">{TRANSACTION_LABEL[t.reason] ?? t.reason}</div>
                  <div className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</div>
                </div>
                <div className={`font-bold ${t.type === "CREDIT" ? "text-success" : "text-danger"}`}>
                  {t.type === "CREDIT" ? "+" : "−"}₹{t.amount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
