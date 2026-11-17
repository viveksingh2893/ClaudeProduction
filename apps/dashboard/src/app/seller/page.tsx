import { redirect } from "next/navigation";
import { getSellerProfileForUser } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";
import { getFullName } from "@kisan4u/db";
import { AlertBox, PageContainer, PageHeader } from "@kisan4u/ui";

export default async function SellerDashboardPage() {
  const session = await requireSession(["SELLER"]);
  const displayName = getFullName(session.user) ?? "Seller";

  // Server-side approval-status gate, re-checked fresh from the DB on
  // every load — the middleware role check alone can't see live status
  // changes (Edge runtime, no DB access).
  const profile = await getSellerProfileForUser(session.user.id);
  if (!profile || profile.status !== "APPROVED") {
    redirect("/seller/status");
  }

  return (
    <PageContainer maxWidth="900px" className="py-10">
      <PageHeader title="Seller Dashboard" description={`Welcome, ${displayName}.`} />
      <AlertBox tone="info">
        Use the menu on the left to navigate — your products, orders, settlements, licences, and
        profile are all there.
      </AlertBox>
    </PageContainer>
  );
}
