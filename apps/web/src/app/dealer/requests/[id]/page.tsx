import { notFound, redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getDealerRequestById } from "@kisan4u/catalog";
import { Breadcrumbs, Card, PageContainer, StatusBadge } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { CancelButton } from "./cancel-button";

export default async function DealerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile) redirect("/login");
  if (profile.status !== "APPROVED") redirect("/dealer/status");

  const { id } = await params;
  const request = await getDealerRequestById(profile.id, id);
  if (!request) notFound();

  return (
    <PageContainer maxWidth="600px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "My Requests", href: "/dealer/requests" },
            { label: request.product.name },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold text-earth-700">{request.product.name}</h1>
        <StatusBadge status={request.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-gray-500">{request.publicRequestNumber}</p>

      <Card className="mt-5 divide-y divide-border p-1">
        {request.variant && <Row label="Variant SKU" value={request.variant.sku} />}
        <Row label="Seller" value={request.seller.shopName} />
        <Row label="Quantity" value={String(request.quantity)} />
        <Row label="Delivery Address" value={request.deliveryAddress} />
        <Row label="Delivery State" value={request.deliveryState.name} />
        {request.neededByDate && (
          <Row
            label="Needed By"
            value={new Date(request.neededByDate).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          />
        )}
        {request.note && <Row label="Your Requirement" value={request.note} />}
      </Card>

      {request.status === "REJECTED" && request.rejectionReason && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-red-700">Reason</div>
          <p className="mt-1 text-sm text-red-800">{request.rejectionReason}</p>
        </div>
      )}

      {!["CLOSED", "CANCELLED", "REJECTED"].includes(request.status) && (
        <div className="mt-5">
          <CancelButton requestId={request.id} />
        </div>
      )}
    </PageContainer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</span>
      <span className="text-right text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
