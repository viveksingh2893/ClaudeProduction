import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PackageOpen } from "lucide-react";
import {
  getProductForAdmin,
  evaluateSellingLicenceEligibility,
  diagnoseProductVisibility,
  explainBlockedState,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import {
  ActiveBadge,
  AlertBox,
  Card,
  EmptyState,
  LinkButton,
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
  formatDateTimeDDMMYYYY,
} from "@kisan4u/ui";
import { SafeHtml } from "@kisan4u/ui/SafeHtml";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { ProductActions } from "../product-actions";
import { StateEligibilityChecker } from "./state-eligibility-checker";

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

type AdminProduct = NonNullable<Awaited<ReturnType<typeof getProductForAdmin>>>;

function VariantsTable({ variants }: { variants: AdminProduct["variants"] }) {
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

export default async function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { id } = await params;
  const product = await getProductForAdmin(id);
  if (!product) notFound();

  const customerVariants = product.variants.filter((v) => v.audience === "CUSTOMER");
  const dealerVariants = product.variants.filter((v) => v.audience === "DEALER");
  const eligibility = product.seller
    ? await evaluateSellingLicenceEligibility(product.seller.id, {
        categoryId: product.category.id,
        subCategoryId: product.subCategory?.id ?? null,
        subSubCategoryId: product.subSubCategory?.id ?? null,
      })
    : null;

  const customerDiagnosis = eligibility
    ? diagnoseProductVisibility(product, "customer", eligibility.customer)
    : null;
  const dealerDiagnosis = eligibility
    ? diagnoseProductVisibility(product, "dealer", eligibility.dealer)
    : null;

  // Spec §9 "evaluated eligibility for the selected state" — precomputed
  // server-side (rather than shipping licence-eligibility.ts's DB-backed
  // module into the client bundle) so the picker below is a pure
  // presentational client component with no eligibility logic of its own.
  const stateEligibilityByStateId: Record<
    string,
    {
      customerAvailable: boolean;
      customerReasons: string[];
      dealerAvailable: boolean;
      dealerReasons: string[];
    }
  > = {};
  let activeStates: { id: string; name: string }[] = [];
  if (eligibility) {
    activeStates = await prisma.indianState.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    for (const s of activeStates) {
      stateEligibilityByStateId[s.id] = {
        customerAvailable:
          eligibility.customer.isPanIndia || eligibility.customer.eligibleStateIds.includes(s.id),
        customerReasons: explainBlockedState(eligibility, "customer", s.id),
        dealerAvailable:
          eligibility.dealer.isPanIndia || eligibility.dealer.eligibleStateIds.includes(s.id),
        dealerReasons: explainBlockedState(eligibility, "dealer", s.id),
      };
    }
  }

  return (
    <PageContainer className="py-8" maxWidth="1000px">
      <Link
        href="/admin/products"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to products
      </Link>
      <PageHeader
        title={product.name}
        description={
          <>
            Seller: {product.seller ? product.seller.shopName : "In-house"} · Audience:{" "}
            {product.audience}
          </>
        }
        actions={
          <>
            <StatusBadge status={product.lifecycleStatus} />
            <LinkButton href={`/admin/products/${product.id}/edit`} variant="outline" size="sm">
              Edit this product
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-col gap-8">
        {product.lifecycleStatus === "REJECTED" && product.rejectionReason && (
          <AlertBox tone="danger" title="Rejection reason">
            {product.rejectionReason}
          </AlertBox>
        )}

        <Card className="p-4">
          <ProductActions productId={product.id} status={product.lifecycleStatus} />
        </Card>

        <DetailSection title="General">
          <Card className="divide-y divide-border p-4">
            <KeyValue label="SKU" value={product.sku} />
            <KeyValue label="HSN" value={product.hsnCode} />
            <KeyValue label="Unit" value={product.baseUnit} />
            <KeyValue label="Package" value={product.packageSize} />
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

        {eligibility && customerDiagnosis && dealerDiagnosis && (
          <DetailSection title="Selling licence compliance diagnostic">
            <Card className="flex flex-col gap-2 p-4 text-sm">
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <div className="flex-1 rounded-lg border border-border p-3">
                  <div className="mb-1 text-[13px] font-bold text-ink">Customer</div>
                  <div
                    className={
                      customerDiagnosis.purchasable
                        ? "text-[13px] text-success"
                        : "text-[13px] text-danger"
                    }
                  >
                    {customerDiagnosis.purchasable
                      ? "Purchasable"
                      : customerDiagnosis.visibleInCatalogue
                        ? "Visible, not purchasable"
                        : "Hidden"}
                  </div>
                  {customerDiagnosis.reason && (
                    <div className="mt-1 text-[13px] text-gray-600">{customerDiagnosis.reason}</div>
                  )}
                </div>
                <div className="flex-1 rounded-lg border border-border p-3">
                  <div className="mb-1 text-[13px] font-bold text-ink">Dealer</div>
                  <div
                    className={
                      dealerDiagnosis.purchasable
                        ? "text-[13px] text-success"
                        : "text-[13px] text-danger"
                    }
                  >
                    {dealerDiagnosis.purchasable
                      ? "Purchasable"
                      : dealerDiagnosis.visibleInCatalogue
                        ? "Visible, not purchasable"
                        : "Hidden"}
                  </div>
                  {dealerDiagnosis.reason && (
                    <div className="mt-1 text-[13px] text-gray-600">{dealerDiagnosis.reason}</div>
                  )}
                </div>
              </div>
              <p className="text-[13px] text-gray-500">
                Last compliance recalculation:{" "}
                {product.licenceComplianceCheckedAt
                  ? formatDateTimeDDMMYYYY(product.licenceComplianceCheckedAt)
                  : "never"}
              </p>
            </Card>

            {activeStates.length > 0 && (
              <StateEligibilityChecker
                states={activeStates}
                byStateId={stateEligibilityByStateId}
              />
            )}

            {eligibility.requirements.length === 0 ? (
              <p className="text-[13px] text-gray-500">
                No licence requirements apply to this product&apos;s category path.
              </p>
            ) : (
              <Card className="divide-y divide-border p-4 text-sm">
                {eligibility.requirements.map((r) => (
                  <div key={r.requirementId} className="flex flex-col gap-1 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">
                        {r.name}{" "}
                        <span className="font-normal text-gray-500">
                          (
                          {r.source === "CATEGORY"
                            ? "inherited from category"
                            : r.source === "SUBCATEGORY"
                              ? "inherited from subcategory"
                              : "direct"}
                          )
                        </span>
                      </span>
                    </div>
                    {r.customer.required && (
                      <div className="text-[13px]">
                        Customer:{" "}
                        <span
                          className={
                            r.customer.status === "APPROVED"
                              ? "font-semibold text-success"
                              : "font-semibold text-danger"
                          }
                        >
                          {r.customer.status}
                        </span>
                        {r.customer.reason ? ` — ${r.customer.reason}` : ""}
                      </div>
                    )}
                    {r.dealer.required && (
                      <div className="text-[13px]">
                        Dealer:{" "}
                        <span
                          className={
                            r.dealer.status === "APPROVED"
                              ? "font-semibold text-success"
                              : "font-semibold text-danger"
                          }
                        >
                          {r.dealer.status}
                        </span>
                        {r.dealer.reason ? ` — ${r.dealer.reason}` : ""}
                      </div>
                    )}
                  </div>
                ))}
                <p className="pt-2 text-[13px] text-gray-500">
                  Customer eligible states:{" "}
                  {eligibility.customer.isPanIndia
                    ? "all"
                    : eligibility.customer.eligibleStateIds.length}{" "}
                  · Dealer eligible states:{" "}
                  {eligibility.dealer.isPanIndia
                    ? "all"
                    : eligibility.dealer.eligibleStateIds.length}
                  . Approval here never overrides a missing licence — add/approve it via Seller
                  Licences first.
                </p>
              </Card>
            )}
          </DetailSection>
        )}

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
