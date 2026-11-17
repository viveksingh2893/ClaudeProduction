import { redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getFullName } from "@kisan4u/db";
import { getWalletSummary, isBaProgramEnabled, getBaProfileForUser } from "@kisan4u/orders";
import { Card, LinkButton, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { getT } from "@/i18n/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AccountPage() {
  const session = await requireSession(["CUSTOMER", "DEALER"]);
  const { id, role } = session.user;
  const { t } = await getT();
  // The session carries firstName/lastName raw (never a joined `name`
  // field — see @kisan4u/auth types.d.ts), so compose it here the same way
  // SiteHeader does; `session.user.name` is always undefined.
  const name = getFullName(session.user);

  // Server-side approval-status gate, re-checked fresh from the DB on
  // every load — middleware only proves the session is authenticated, it
  // can't see live approval-status changes (Edge runtime, no DB access).
  if (role === "DEALER") {
    const profile = await getDealerProfileForUser(id);
    if (!profile || profile.status !== "APPROVED") {
      redirect("/dealer/status");
    }
  }

  const roleLabel = role === "DEALER" ? t("account.roleDealer") : t("account.roleCustomer");
  const [wallet, baEnabled, baProfile] = await Promise.all([
    getWalletSummary(id, role as "CUSTOMER" | "DEALER"),
    isBaProgramEnabled(),
    getBaProfileForUser(id),
  ]);
  // "Registered as BA" = actually approved (referral code live/usable) —
  // a still-pending/rejected/suspended applicant sees the generic label,
  // matching resolveReferralCode's own ACTIVE_BA_STATUSES gate.
  const isActiveBa =
    baProfile?.frontendStatus === "APPROVED_NO_BANK" || baProfile?.frontendStatus === "APPROVED";

  const links =
    role === "DEALER"
      ? [
          { href: "/dealer/products", label: t("account.dealerCatalogue") },
          { href: "/dealer/requests", label: t("account.myRequests") },
          { href: "/cart", label: t("account.cart") },
          { href: "/orders", label: t("account.myOrders") },
          { href: "/addresses", label: t("account.savedAddresses") },
          { href: "/account/wallet", label: t("account.wallet") },
          { href: "/account/profile", label: t("account.profile") },
        ]
      : [
          { href: "/products", label: t("account.browseProducts") },
          { href: "/cart", label: t("account.cart") },
          { href: "/orders", label: t("account.myOrders") },
          { href: "/addresses", label: t("account.savedAddresses") },
          { href: "/account/wallet", label: t("account.wallet") },
          { href: "/account/profile", label: t("account.profile") },
        ];

  if (baEnabled) {
    links.push({
      href: "/account/ba",
      label: isActiveBa ? "BA Referral Code and Earnings" : t("account.businessAssociate"),
    });
  }

  return (
    <PageContainer maxWidth="700px" className="py-8">
      <PageHeader
        title={name ? t("account.welcomeName", { name }) : t("account.welcome")}
        description={t("account.loggedInAs", { role: roleLabel })}
        actions={<SignOutButton />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <LinkButton key={link.href} href={link.href} variant="outline">
            {link.label} <span aria-hidden>→</span>
          </LinkButton>
        ))}
      </div>

      <Card className="mt-6 flex items-center justify-between p-4">
        <div>
          <div className="text-sm text-gray-600">{t("account.walletBalance")}</div>
          <div className="text-xl font-extrabold text-ink">₹{wallet.balance.toFixed(2)}</div>
        </div>
        <LinkButton href="/account/wallet" variant="outline">
          {t("account.manageWallet")} →
        </LinkButton>
      </Card>
      <Card className="mt-3 p-4 text-sm text-gray-600">Wishlist arrives in a later phase.</Card>
      <div className="mt-6"><LinkButton href="/account/delete" variant="outline">Delete account</LinkButton></div>
    </PageContainer>
  );
}
