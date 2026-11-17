import { notFound } from "next/navigation";
import { getAdminRequestById } from "@kisan4u/catalog";
import { prisma, getFullName } from "@kisan4u/db";
import {
  Breadcrumbs,
  Card,
  PageContainer,
  StatusBadge,
  Thumbnail,
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
} from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { RequestReviewActions } from "./review-actions";

export default async function AdminProductRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { id } = await params;
  const request = await getAdminRequestById(id);
  if (!request) notFound();

  const auditEntries = await prisma.auditLog.findMany({
    where: { entityType: "SellerProductRequest", entityId: id },
    orderBy: { createdAt: "desc" },
  });
  const actorIds = [...new Set(auditEntries.map((a) => a.actorId))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true, phone: true },
      })
    : [];
  const actorNameById = new Map(
    actors.map((a) => [a.id, getFullName(a) ?? a.phone ?? "—"]),
  );

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Product requests", href: "/admin/product-requests" },
            { label: request.publicRequestNumber },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold text-ink">{request.product.name}</h1>
        <StatusBadge status={request.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-gray-500">{request.publicRequestNumber}</p>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card className="divide-y divide-border p-1">
            <div className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-600">
              Request
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Thumbnail src={resolveStorefrontAssetUrl(request.product.primaryImageUrl)} alt="" />
              <div>
                <div className="text-sm font-bold text-ink">{request.product.name}</div>
                {request.variant && (
                  <div className="text-xs text-gray-600">SKU {request.variant.sku}</div>
                )}
              </div>
            </div>
            <Row label="Quantity" value={String(request.quantity)} />
            <Row label="Delivery address" value={request.deliveryAddress} />
            <Row label="Delivery state" value={request.deliveryState.name} />
            {request.neededByDate && (
              <Row label="Needed by" value={formatDateDDMMYYYY(request.neededByDate)} />
            )}
            <Row label="Submitted" value={formatDateTimeDDMMYYYY(request.createdAt)} />
            <Row label="Seller" value={request.seller.shopName} />
          </Card>

          <Card className="divide-y divide-border p-1">
            <div className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-600">
              Dealer (admin-only — never shown to the seller)
            </div>
            <Row
              label="Name"
              value={getFullName(request.dealer.user) ?? request.dealer.user.phone ?? "—"}
            />
            {request.dealer.user.email && <Row label="Email" value={request.dealer.user.email} />}
            {request.dealer.user.phone && <Row label="Phone" value={request.dealer.user.phone} />}
            <Row label="Store name" value={request.dealer.storeName ?? "—"} />
            <Row label="Store address" value={request.dealer.storeAddress ?? "—"} />
            <Row label="City" value={request.dealer.city ?? "—"} />
            <Row label="GST number" value={request.dealer.gstNumber ?? "—"} />
            <Row label="License number" value={request.dealer.licenseNumber ?? "—"} />
          </Card>

          {request.note && (
            <Card className="p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-600">
                Dealer's raw requirement (admin-only)
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{request.note}</p>
            </Card>
          )}

          {auditEntries.length > 0 && (
            <Card className="p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-600">
                Approval history
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {auditEntries.map((entry) => (
                  <li key={entry.id} className="text-sm text-gray-700">
                    <span className="font-semibold text-ink">
                      {entry.action.replace(/_/g, " ")}
                    </span>{" "}
                    by{" "}
                    <span className="font-semibold text-ink">
                      {actorNameById.get(entry.actorId) ?? "Unknown admin"}
                    </span>{" "}
                    on {formatDateTimeDDMMYYYY(entry.createdAt)}
                    {entry.reason && (
                      <div className="mt-0.5 text-xs text-gray-500">Reason: {entry.reason}</div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <RequestReviewActions
            requestId={request.id}
            status={request.status}
            sellerVisibleSummary={request.sellerVisibleSummary ?? ""}
            adminNotes={request.adminNotes ?? ""}
            rejectionReason={request.rejectionReason ?? ""}
            defaultSummarySeed={request.note ?? ""}
          />
        </div>
      </div>
    </PageContainer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
      </span>
      <span className="text-right text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
