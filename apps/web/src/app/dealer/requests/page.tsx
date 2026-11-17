import Link from "next/link";
import { redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getDealerRequests } from "@kisan4u/catalog";
import { EmptyState, LinkButton, PageContainer, PageHeader, StatusBadge } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";

export default async function DealerRequestsPage() {
  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile) redirect("/login");
  if (profile.status !== "APPROVED") redirect("/dealer/status");

  const requests = await getDealerRequests(profile.id);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="My Requests"
        description="Enquiries sent to sellers — not orders, and do not reserve stock or price."
        actions={
          <LinkButton href="/dealer/products" variant="outline" size="sm">
            ← Dealer Catalogue
          </LinkButton>
        }
      />

      {requests.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Send a request from a product's detail page when it isn't available for direct purchase in your state."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">Request #</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Seller</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {r.publicRequestNumber}
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink">{r.product.name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.seller.shopName}</td>
                  <td className="px-4 py-3 text-gray-600">{r.quantity}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dealer/requests/${r.id}`}
                      className="font-bold text-earth-700 hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
