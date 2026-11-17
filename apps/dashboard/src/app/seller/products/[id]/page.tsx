import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { getProductForSellerEdit, assertOwnsProduct } from "@kisan4u/catalog";
import {
  ActiveBadge,
  AlertBox,
  Card,
  EmptyState,
  PageContainer,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  Thumbnail,
  formatCurrency,
  formatNumber,
} from "@kisan4u/ui";
import { SafeHtml } from "@kisan4u/ui/SafeHtml";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { SellerProductActions } from "./seller-product-actions";

function DetailSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-green-800">
        {title}
        {count !== undefined && (
          <span className="ml-1.5 font-normal normal-case text-gray-500">({count})</span>
        )}
      </h2>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="shrink-0 text-gray-600">{label}</span>
      <span className="break-words text-right text-ink">{value}</span>
    </div>
  );
}

function ConfigCard({ title, config }: { title: string; config: Record<string, unknown> | null }) {
  if (!config) return null;
  const entries = Object.entries(config).filter(([key]) => key !== "productId");
  return (
    <Card className="flex-1 divide-y divide-border p-4">
      <div className="pb-2 text-[13px] font-bold text-ink">{title}</div>
      {entries.map(([key, value]) => (
        <KeyValue key={key} label={key} value={String(value)} />
      ))}
    </Card>
  );
}

type SellerProduct = NonNullable<Awaited<ReturnType<typeof getProductForSellerEdit>>>;

function VariantsTable({ variants }: { variants: SellerProduct["variants"] }) {
  if (variants.length === 0) {
    return <EmptyState title="No variants" />;
  }
  return (
    <TableShell>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Attributes</TableHeaderCell>
            <TableHeaderCell>SKU</TableHeaderCell>
            <TableHeaderCell align="right">MRP</TableHeaderCell>
            <TableHeaderCell align="right">Selling price</TableHeaderCell>
            <TableHeaderCell align="right">Stock</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {variants.map((v) => (
            <TableRow key={v.id}>
              <TableCell>
                {v.values.map((val) => val.attributeValue.value).join(" / ") || "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-gray-600">{v.sku}</TableCell>
              <TableCell align="right">{formatCurrency(v.mrp.toString())}</TableCell>
              <TableCell align="right" className="font-semibold">
                {formatCurrency(v.sellingPrice.toString())}
              </TableCell>
              <TableCell align="right">{formatNumber(v.stockQty)}</TableCell>
              <TableCell>
                <ActiveBadge active={v.isActive} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

/** What each status actually means, one level more specific than the bare pill — DRAFT/REJECTED aren't listed since those redirect straight to /edit instead of showing this review page. */
const STATUS_COPY: Record<
  "SUBMITTED" | "APPROVED" | "SUSPENDED" | "INACTIVE",
  { title: string; body: string; tone: "info" | "success" | "danger" }
> = {
  SUBMITTED: {
    title: "Waiting on admin review",
    body: "An admin will approve or reject this listing — you'll be notified either way. If it's rejected you can edit and resubmit it immediately.",
    tone: "info",
  },
  APPROVED: {
    title: "Live",
    body: "This product is approved and visible wherever its audience, category, and state availability allow. Editing it will resubmit it for admin review and take it off the storefront until reviewed again.",
    tone: "success",
  },
  SUSPENDED: {
    title: "Suspended by an admin",
    body: "This listing has been taken down and isn't visible anywhere. Contact support if you're not sure why.",
    tone: "danger",
  },
  INACTIVE: {
    title: "Deactivated",
    body: "This listing is currently pulled from the storefront and not visible to anyone.",
    tone: "info",
  },
};

/**
 * Always the review page now — editing lives at its own /edit route (see
 * ./edit/page.tsx), mirroring admin's own /admin/products/[id] (review) vs
 * /admin/products/[id]/edit split. A seller's action set here is
 * deliberately smaller than admin's equivalent page: Edit, Deactivate/
 * Activate, and Delete — approve/reject/suspend stay admin-only decisions
 * (see seller-product-actions.tsx).
 */
export default async function SellerProductReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;

  const owns = await assertOwnsProduct(sellerProfileId, id);
  if (!owns.ok) notFound();

  const product = await getProductForSellerEdit(id);
  if (!product) notFound();

  const customerVariants = product.variants.filter((v) => v.audience === "CUSTOMER");
  const dealerVariants = product.variants.filter((v) => v.audience === "DEALER");
  const statusCopy =
    product.lifecycleStatus === "DRAFT" || product.lifecycleStatus === "REJECTED"
      ? null
      : STATUS_COPY[product.lifecycleStatus];

  return (
    <PageContainer className="py-8" maxWidth="1000px">
      <Link
        href="/seller/products"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to my products
      </Link>
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku}`}
        actions={<StatusBadge status={product.lifecycleStatus} />}
      />

      <div className="flex flex-col gap-8">
        {product.lifecycleStatus === "REJECTED" && product.rejectionReason && (
          <AlertBox tone="danger" title="Rejected">
            {product.rejectionReason} Edit and resubmit to have it reviewed again.
          </AlertBox>
        )}
        {statusCopy && (
          <AlertBox tone={statusCopy.tone} title={statusCopy.title}>
            {statusCopy.body}
          </AlertBox>
        )}

        <Card className="p-4">
          <SellerProductActions productId={product.id} status={product.lifecycleStatus} />
        </Card>

        <DetailSection title="General">
          <Card className="divide-y divide-border p-4">
            <KeyValue label="SKU" value={product.sku} />
            <KeyValue label="HSN" value={product.hsnCode} />
            <KeyValue label="Unit" value={product.baseUnit} />
            <KeyValue label="Package" value={product.packageSize} />
            <KeyValue label="Audience" value={product.audience.replace(/_/g, " ")} />
          </Card>
          <Card className="p-4 text-sm text-ink">
            <SafeHtml html={product.shortDescription} className="mb-2" />
            <SafeHtml html={product.description} className="text-gray-600" />
          </Card>
        </DetailSection>

        <DetailSection title="Category">
          <Card className="divide-y divide-border p-4">
            <KeyValue
              label="Category"
              value={`${product.category.name}${product.subCategory ? ` → ${product.subCategory.name}` : ""}${product.subSubCategory ? ` → ${product.subSubCategory.name}` : ""}`}
            />
            <KeyValue label="Brand" value={product.brand?.name ?? "—"} />
            <KeyValue label="Manufacturer" value={product.manufacturer?.name ?? "—"} />
          </Card>
        </DetailSection>

        <DetailSection title="Customer & dealer configuration">
          <div className="flex flex-col gap-4 sm:flex-row">
            <ConfigCard title="Customer configuration" config={product.customerConfig} />
            <ConfigCard title="Dealer configuration" config={product.dealerConfig} />
          </div>
        </DetailSection>

        <DetailSection title="Customer variants" count={customerVariants.length}>
          <VariantsTable variants={customerVariants} />
        </DetailSection>

        <DetailSection title="Dealer variants" count={dealerVariants.length}>
          <VariantsTable variants={dealerVariants} />
        </DetailSection>

        <DetailSection title="State availability">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Card className="flex-1 p-4 text-sm text-ink">
              <div className="mb-1 text-[13px] font-bold text-ink">Customer</div>
              {product.customerAvailableStates.length === 0
                ? "Available nationwide (no state restriction)"
                : product.customerAvailableStates.map((s) => s.name).join(", ")}
            </Card>
            <Card className="flex-1 p-4 text-sm text-ink">
              <div className="mb-1 text-[13px] font-bold text-ink">Dealer</div>
              {product.dealerAvailableStates.length === 0
                ? "Available nationwide (no state restriction)"
                : product.dealerAvailableStates.map((s) => s.name).join(", ")}
            </Card>
          </div>
        </DetailSection>

        <DetailSection title="Images">
          {product.images.length === 0 && !product.primaryImageUrl ? (
            <EmptyState
              icon={<PackageOpen className="h-8 w-8" aria-hidden="true" />}
              title="No images uploaded"
            />
          ) : (
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <Thumbnail
                  src={resolveStorefrontAssetUrl(product.primaryImageUrl)}
                  alt="Primary image"
                  size="lg"
                />
                <span className="text-[11px] font-bold text-green-700">Primary</span>
              </div>
              {product.images.map((img) => (
                <div key={img.id} className="flex flex-col items-center gap-1.5">
                  <Thumbnail src={resolveStorefrontAssetUrl(img.url)} alt="" size="lg" />
                  {!img.isActive && <ActiveBadge active={false} />}
                </div>
              ))}
            </div>
          )}
          {product.videoUrl && (
            <Card className="p-4 text-sm">
              <span className="text-gray-600">Video: </span>
              <span className="break-all text-ink">{product.videoUrl}</span>
            </Card>
          )}
        </DetailSection>

        <DetailSection title="SEO">
          <Card className="divide-y divide-border p-4">
            <KeyValue label="Slug" value={product.slug} />
            <KeyValue label="Meta title" value={product.metaTitle ?? "—"} />
            <KeyValue label="Meta description" value={product.metaDescription ?? "—"} />
          </Card>
        </DetailSection>
      </div>
    </PageContainer>
  );
}
