import { notFound } from "next/navigation";
import { getSellerRequestById } from "@kisan4u/catalog";
import {
  Breadcrumbs,
  Card,
  PageContainer,
  StatusBadge,
  Thumbnail,
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
} from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { RequestStatusActions } from "./status-actions";

/**
 * Strict dealer anonymity (spec §8): getSellerRequestById already selects
 * only the seller-safe field set — no `dealer` relation, no `note`, no
 * `deliveryAddress` are ever fetched here. Never widen this page to read
 * those fields even for display; if the seller needs more, that's an
 * admin-panel change to `sellerVisibleSummary`, not a leak here.
 */
export default async function SellerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;
  const request = await getSellerRequestById(sellerProfileId, id);
  if (!request) notFound();

  return (
    <PageContainer maxWidth="640px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Dealer requests", href: "/seller/requests" },
            { label: request.publicRequestNumber },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold text-ink">{request.product.name}</h1>
        <StatusBadge status={request.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-gray-500">{request.publicRequestNumber}</p>

      <Card className="mt-5 divide-y divide-border p-1">
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
        <Row label="Requested delivery state" value={request.deliveryState.name} />
        {request.neededByDate && (
          <Row label="Needed by" value={formatDateDDMMYYYY(request.neededByDate)} />
        )}
        <Row label="Received" value={formatDateTimeDDMMYYYY(request.createdAt)} />
      </Card>

      {request.sellerVisibleSummary && (
        <Card className="mt-5 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-600">
            Requirement summary
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{request.sellerVisibleSummary}</p>
        </Card>
      )}

      <div className="mt-5">
        <RequestStatusActions requestId={request.id} status={request.status} />
      </div>
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
