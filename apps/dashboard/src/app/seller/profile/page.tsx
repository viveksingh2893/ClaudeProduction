import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { getUserBasicInfo, getSellerProfileForUser } from "@kisan4u/auth";
import { getFullName } from "@kisan4u/db";
import { Card, PageContainer, PageHeader, StatusBadge, formatCurrency } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { AvatarCircle } from "@/components/avatar-circle";
import { DetailSection, KeyValue } from "@/components/detail-section";

export default async function SellerProfilePage() {
  const session = await requireSession(["SELLER"]);

  const user = await getUserBasicInfo(session.user.id);
  const sellerProfile = await getSellerProfileForUser(session.user.id);
  if (!user || !sellerProfile) {
    redirect("/login");
  }

  const displayName = getFullName(user) ?? user.phone ?? "—";

  return (
    <PageContainer maxWidth="640px" className="py-8">
      <div className="mb-4">
        <Link
          href="/seller"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to seller dashboard
        </Link>
      </div>
      <PageHeader title="My Profile" />

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <AvatarCircle name={sellerProfile.shopName} seed={sellerProfile.id} size="lg" />
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-ink">{sellerProfile.shopName}</div>
              <div className="text-sm text-gray-500">{displayName}</div>
            </div>
          </div>
          <StatusBadge status={sellerProfile.status} />
        </div>

        <hr className="my-6 border-border" />

        <div className="grid gap-6 sm:grid-cols-2">
          <DetailSection title="Account details">
            <KeyValue label="Email" value={user.email} />
            <KeyValue label="Phone" value={user.phone ?? "—"} />
          </DetailSection>

          <DetailSection title="Business details">
            <KeyValue label="Shop name" value={sellerProfile.shopName} />
            <KeyValue label="GST number" value={sellerProfile.gstNumber ?? "—"} />
            <KeyValue label="Customer commission" value={`${sellerProfile.commissionPercent}%`} />
            <KeyValue label="Dealer commission" value={`${sellerProfile.dealerCommissionPercent}%`} />
            <KeyValue
              label="Minimum order amount"
              value={formatCurrency(sellerProfile.minOrderAmount.toString())}
            />
          </DetailSection>
        </div>

        {sellerProfile.isTemporarilyClosed && (
          <div className="mt-6 rounded-md border border-warning-bg bg-warning-bg px-4 py-3 text-xs font-semibold text-warning">
            Your shop is currently marked as temporarily closed to customers.
            {sellerProfile.vacationNote ? ` "${sellerProfile.vacationNote}"` : ""}
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-bg-dashboard px-4 py-3 text-xs text-gray-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
        <span>This is a read-only view for now — editing your profile arrives in a later update.</span>
      </div>
    </PageContainer>
  );
}
