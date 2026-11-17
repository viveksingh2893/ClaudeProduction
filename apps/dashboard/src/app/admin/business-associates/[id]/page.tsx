import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, IndianRupee, ShieldAlert, Users, Wallet as WalletIcon } from "lucide-react";
import { prisma } from "@kisan4u/db";
import {
  getBaProfileById,
  getBaWalletSummary,
  listBaEarnings,
  listBaSettlements,
} from "@kisan4u/orders";
import {
  ActiveBadge,
  Badge,
  Card,
  PageContainer,
  PageHeader,
  StatusBadge,
  formatDate,
} from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { DetailSection, KeyValue } from "@/components/detail-section";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { BaRowActions } from "../ba-row-actions";
import { BaDetailClient } from "./detail-client";
import { BankReviewPanel } from "./bank-review-panel";

const TAB_VALUES = new Set(["overview", "referrals", "ledger", "payouts", "kyc"]);

export default async function AdminBaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { id } = await params;
  const sp = await searchParams;
  const tab = TAB_VALUES.has(sp.tab ?? "") ? sp.tab! : "overview";

  const profile = await getBaProfileById(id);
  if (!profile) notFound();

  const [user, wallet, earnings, settlements, referredCustomers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: profile.userId },
      select: {
        id: true,
        isActive: true,
        accountDeletionRequests: {
          where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    }),
    getBaWalletSummary(id),
    listBaEarnings(id, { take: 50 }),
    listBaSettlements(id),
    prisma.user.findMany({
      where: { referredByBaId: id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  if (!user) notFound();

  const orderCommissionCount = earnings.filter((e) => e.kind === "ORDER_COMMISSION").length;
  const name = `${profile.firstName} ${profile.lastName}`;
  const basePath = `/admin/business-associates/${id}`;

  const tabs: StatusTabItem[] = [
    { key: "overview", label: "Overview", href: `${basePath}?tab=overview` },
    {
      key: "referrals",
      label: "Referrals",
      count: referredCustomers.length,
      href: `${basePath}?tab=referrals`,
    },
    {
      key: "ledger",
      label: "Commission Ledger",
      count: earnings.length,
      href: `${basePath}?tab=ledger`,
    },
    {
      key: "payouts",
      label: "Payout History",
      count: settlements.length,
      href: `${basePath}?tab=payouts`,
    },
    { key: "kyc", label: "Bank & KYC", href: `${basePath}?tab=kyc` },
  ];

  return (
    <PageContainer className="py-8" maxWidth="1000px">
      <Link
        href="/admin/business-associates"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All Business Associates
      </Link>
      <PageHeader
        title={name}
        description={`${profile.referralCode} · ${profile.city}, ${profile.state}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={profile.status} />
            <ActiveBadge active={user.isActive} />
            <BaRowActions
              baId={profile.id}
              userId={user.id}
              userName={name}
              isActive={user.isActive}
              status={profile.status}
              deletionStatus={toActiveDeletionStatus(user.accountDeletionRequests[0]?.status)}
            />
          </div>
        }
      />

      <StatCardsRow>
        <StatCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          label="Referred customers"
          value={referredCustomers.length}
        />
        <StatCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          label="Referred orders"
          value={orderCommissionCount}
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Total commission"
          value={`₹${wallet.totalEarned.toFixed(2)}`}
        />
        <StatCard
          icon={<WalletIcon className="h-5 w-5" aria-hidden="true" />}
          label="Redeemable"
          value={`₹${wallet.eligible.toFixed(2)}`}
          tone={wallet.eligible > 0 ? "amber" : "neutral"}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {(!profile.hasBankDetails || !profile.panNumber) && (
          <AlertBanner
            tone="amber"
            title="Payout not ready — missing bank details or PAN"
            href={`${basePath}?tab=kyc`}
            linkLabel="Review"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />

      <div className="mt-4 flex flex-col gap-6">
        {tab === "overview" && (
          <Card className="divide-y divide-border p-4">
            <KeyValue label="Contact number" value={profile.contactNumber} />
            <KeyValue label="Email" value={profile.email} />
            <KeyValue
              label="Locked (pending eligibility)"
              value={`₹${wallet.lockedPending.toFixed(2)}`}
            />
            <KeyValue label="Paid out" value={`₹${wallet.settled.toFixed(2)}`} />
            <KeyValue label="Reversed" value={`₹${wallet.reversed.toFixed(2)}`} />
            {profile.rejectedReason && (
              <KeyValue label="Rejection reason" value={profile.rejectedReason} />
            )}
          </Card>
        )}

        {tab === "referrals" && (
          <DetailSection title={`Referred customers (${referredCustomers.length})`}>
            {referredCustomers.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">No referrals yet.</Card>
            ) : (
              <Card className="divide-y divide-border p-4">
                {referredCustomers.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-ink">
                      {c.firstName} {c.lastName} <span className="text-gray-400">({c.role})</span>
                    </span>
                    <span className="text-gray-500">{formatDate(c.createdAt)}</span>
                  </div>
                ))}
              </Card>
            )}
          </DetailSection>
        )}

        {tab === "ledger" && (
          <DetailSection title="Commission ledger">
            {earnings.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">No earnings recorded yet.</Card>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="p-3">Kind</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3">Source order</th>
                      <th className="p-3 text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earnings.map((e) => (
                      <tr key={e.id} className="border-t border-gray-100">
                        <td className="p-3">{e.kind.replace(/_/g, " ").toLowerCase()}</td>
                        <td className="p-3">
                          <Badge
                            tone={
                              e.status === "REVERSED"
                                ? "danger"
                                : e.status === "SETTLED"
                                  ? "success"
                                  : "warning"
                            }
                          >
                            {e.status.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">₹{Number(e.amount).toFixed(2)}</td>
                        <td className="p-3 font-mono text-xs">{e.sourceSellerOrderId ?? "—"}</td>
                        <td className="p-3 text-right text-xs text-gray-400">
                          {formatDate(e.createdAt, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailSection>
        )}

        {tab === "payouts" && (
          <DetailSection title="Payout history">
            {settlements.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">No payouts processed yet.</Card>
            ) : (
              <Card className="divide-y divide-border p-4">
                {settlements.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-ink">{s.month}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={s.status === "PAID" ? "success" : "warning"}>{s.status}</Badge>
                      <span className="text-gray-500">₹{Number(s.totalAmount).toFixed(2)}</span>
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </DetailSection>
        )}

        {tab === "kyc" && (
          <>
            {(!profile.hasBankDetails || !profile.panNumber) && (
              <AlertBanner
                tone="amber"
                title="Verification incomplete"
                description={
                  <span className="inline-flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    Payouts are blocked until bank details and PAN are both on file.
                  </span>
                }
              />
            )}
            <BankReviewPanel
              baId={profile.id}
              bankStatus={profile.bankStatus}
              bankSubmittedAt={profile.bankSubmittedAt}
              bankReviewedAt={profile.bankReviewedAt}
              bankRejectionReason={profile.bankRejectionReason}
              panNumber={profile.panNumber}
              bankName={profile.bankName}
              bankBranch={profile.bankBranch}
              accountHolderName={profile.accountHolderName}
              accountNumber={profile.accountNumber}
              ifsc={profile.ifsc}
              panDocUrl={
                profile.panDocKey
                  ? `/api/admin/business-associates/${profile.id}/documents/pan`
                  : null
              }
              chequeDocUrl={
                profile.chequeDocKey
                  ? `/api/admin/business-associates/${profile.id}/documents/cheque`
                  : null
              }
            />
            <BaDetailClient
              profile={{
                baId: profile.id,
                status: profile.status,
                firstName: profile.firstName,
                lastName: profile.lastName,
                contactNumber: profile.contactNumber,
                email: profile.email,
                pincode: profile.pincode,
                state: profile.state,
                city: profile.city,
                panNumber: profile.panNumber ?? "",
                bankName: profile.bankName ?? "",
                bankBranch: profile.bankBranch ?? "",
                accountHolderName: profile.accountHolderName ?? "",
                accountNumber: profile.accountNumber ?? "",
                ifsc: profile.ifsc ?? "",
                panDocKey: profile.panDocKey ?? "",
                chequeDocKey: profile.chequeDocKey ?? "",
              }}
            />
          </>
        )}
      </div>
    </PageContainer>
  );
}
