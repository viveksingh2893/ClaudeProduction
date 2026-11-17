import { requireSession } from "@/lib/session-guard";
import { getFullName } from "@kisan4u/db";
import { AlertBox, PageContainer, PageHeader } from "@kisan4u/ui";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", STAFF: "Staff" };

export default async function AdminDashboardPage() {
  const session = await requireSession(["ADMIN", "STAFF"]);
  const displayName =
    getFullName(session.user) ?? ROLE_LABEL[session.user.role] ?? session.user.role;

  return (
    <PageContainer maxWidth="900px" className="py-10">
      <PageHeader title="Admin Dashboard" description={`Welcome, ${displayName}.`} />
      <AlertBox tone="info">
        Use the menu on the left to navigate — user management, the product catalog, orders,
        logistics, and the rest of the admin panel are all there.
      </AlertBox>
    </PageContainer>
  );
}
