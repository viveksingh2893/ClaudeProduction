import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { getUserBasicInfo } from "@kisan4u/auth";
import { getFullName } from "@kisan4u/db";
import { Badge, Card, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { AvatarCircle } from "@/components/avatar-circle";
import { DetailSection, KeyValue } from "@/components/detail-section";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  STAFF: "Staff",
};

export default async function AdminProfilePage() {
  const session = await requireSession(["ADMIN", "STAFF"]);

  const user = await getUserBasicInfo(session.user.id);
  if (!user) {
    redirect("/login");
  }

  const displayName = getFullName(user) ?? user.phone ?? "—";

  return (
    <PageContainer maxWidth="640px" className="py-8">
      <div className="mb-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to admin dashboard
        </Link>
      </div>
      <PageHeader title="My Profile" />

      <Card className="p-6">
        <div className="flex items-center gap-4">
          <AvatarCircle name={displayName} seed={user.id} size="lg" />
          <div className="min-w-0">
            <div className="text-lg font-extrabold text-ink">{displayName}</div>
            <Badge tone="info" className="mt-1">
              {ROLE_LABEL[user.role] ?? user.role}
            </Badge>
          </div>
        </div>

        <hr className="my-6 border-border" />

        <DetailSection title="Account details">
          <KeyValue label="Email" value={user.email} />
          <KeyValue label="Phone" value={user.phone ?? "—"} />
          <KeyValue label="Role" value={ROLE_LABEL[user.role] ?? user.role} />
        </DetailSection>
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-bg-dashboard px-4 py-3 text-xs text-gray-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
        <span>This is a read-only view for now — editing your profile arrives in a later update.</span>
      </div>
    </PageContainer>
  );
}
