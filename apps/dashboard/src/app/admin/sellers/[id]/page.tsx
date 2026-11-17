import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileClock,
  IndianRupee,
  PackageCheck,
  ShoppingBag,
  Store,
  Wallet,
} from "lucide-react";
import { prisma, getFullName } from "@kisan4u/db";
import {
  listSellerOrdersForAdmin,
  listCommissionTableRows,
  getSettlementSummary,
} from "@kisan4u/orders";
import {
  ActiveBadge,
  AnchorButton,
  Badge,
  Card,
  PageContainer,
  StatusBadge,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  DELIVERY_METHOD_LABEL,
} from "@/lib/order-status-labels";
import { parseCommissionFilters } from "@/lib/settlement-filters";
import { DocumentViewerButton } from "@/components/document-viewer-button";
import { DetailSection, KeyValue, SimplePager } from "@/components/detail-section";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { SellerCommissionForm } from "./seller-commission-form";
import { ResetPasswordButton } from "./reset-password-button";
import { EditSellerBusinessButton } from "./edit-seller-business-modal";
import { EditDetailsButton } from "../../edit-account-details-modal";
import { AdminSettlementsSection } from "./admin-settlements-section";
import { SettlementSummaryTiles } from "@/components/settlement-summary-tiles";
import { serializeCommissionRow, serializeSettlementSummary } from "@/lib/settlement-view";
import { SellerRowActions } from "../seller-row-actions";
import { SellerAgreementViewer } from "@/components/seller-agreement-viewer";
import { SellerAgreementUpload } from "./seller-agreement-upload";

/** Card with a title row that can carry a trailing action (e.g. an Edit button). */
function InfoCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</h3>
        {action}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </Card>
  );
}

const ORDERS_PAGE_SIZE = 10;
const TAB_VALUES = [
  "overview",
  "compliance",
  "catalogue",
  "orders",
  "commissions",
  "settings",
  "agreement",
  "activity",
] as const;
type SellerDetailTab = (typeof TAB_VALUES)[number];

export default async function AdminSellerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  // Route param is the SellerProfile id (matches the Sellers table's
  // rowKey convention), not the User id — resolve the user via the
  // profile's own relation.
  const { id } = await params;
  const sp = await searchParams;
  const ordersPage = Math.max(1, Number(sp.ordersPage) || 1);
  const tab: SellerDetailTab = (TAB_VALUES as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as SellerDetailTab)
    : "overview";
  // The table filters below drive the commission table + the Excel export
  // only. The summary tiles above the table are a fixed at-a-glance
  // overview of this seller's WHOLE settlement position and must never
  // move when a filter is applied (otherwise picking, say, a status with
  // no rows blanks the tiles too and the filter looks broken).
  const commissionFilters = parseCommissionFilters(sp);

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { id },
    include: {
      sellingStates: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      // Sensitive fields (passwordHash, sessionVersion) deliberately never
      // selected — allow-list, not exclude-list.
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isActive: true,
          isPhoneVerified: true,
          isEmailVerified: true,
          referralCode: true,
          createdAt: true,
          accountDeletionRequests: {
            where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
            orderBy: { requestedAt: "desc" },
            take: 1,
            select: { status: true },
          },
        },
      },
    },
  });
  if (!sellerProfile) notFound();
  const { user } = sellerProfile;
  const userName = getFullName(user) ?? user.phone ?? "—";

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    ordersResult,
    productCount,
    liveProductCount,
    commissionResult,
    settlementSummary,
    allStates,
    catalogueProducts,
    monthlyAgg,
    auditLogRows,
  ] = await Promise.all([
    listSellerOrdersForAdmin({
      sellerId: sellerProfile.id,
      page: ordersPage,
      pageSize: ORDERS_PAGE_SIZE,
      sortKey: "createdAt",
      sortDir: "desc",
    }),
    prisma.product.count({ where: { sellerId: sellerProfile.id } }),
    prisma.product.count({ where: { sellerId: sellerProfile.id, lifecycleStatus: "APPROVED" } }),
    listCommissionTableRows(sellerProfile.id, commissionFilters),
    // Unfiltered on purpose — see the note where commissionFilters is built.
    getSettlementSummary(sellerProfile.id, {}),
    prisma.indianState.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { sellerId: sellerProfile.id },
      select: {
        id: true,
        name: true,
        lifecycleStatus: true,
        stockStatus: true,
        customerVisible: true,
        dealerVisible: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.sellerOrder.aggregate({
      where: { sellerId: sellerProfile.id, createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "SellerProfile", entityId: sellerProfile.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const ordersTotalPages = Math.max(1, Math.ceil(ordersResult.total / ORDERS_PAGE_SIZE));
  const basePath = `/admin/sellers/${id}`;

  const settlementExportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) if (value) settlementExportParams.set(key, value);

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <Link
        href="/admin/sellers"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All sellers
      </Link>

      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-ink">{userName}</h1>
                <StatusBadge status={sellerProfile.status} />
                <ActiveBadge active={user.isActive} />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
                <Store className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                {sellerProfile.shopName}
              </div>
              <div className="mt-0.5 text-xs text-gray-400">
                Seller since {formatDate(user.createdAt)}
                {user.phone ? ` · ${user.phone}` : ""}
                {user.email ? ` · ${user.email}` : ""}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <EditDetailsButton
                  userId={user.id}
                  firstName={user.firstName}
                  lastName={user.lastName}
                  email={user.email}
                  phone={user.phone}
                />
                <ResetPasswordButton userId={user.id} sellerName={userName} />
                <SellerRowActions
                  profileId={sellerProfile.id}
                  userId={user.id}
                  userName={userName}
                  isActive={user.isActive}
                  status={sellerProfile.status}
                  deletionStatus={toActiveDeletionStatus(user.accountDeletionRequests[0]?.status)}
                />
              </div>
              <Link
                href={`${basePath}?tab=activity`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-green-700"
              >
                <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
                View audit log
              </Link>
            </div>
          </div>
          {sellerProfile.rejectionReason && (
            <p className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">
              Rejection reason: {sellerProfile.rejectionReason}
            </p>
          )}
        </Card>

        <StatCardsRow>
          <StatCard
            icon={<PackageCheck className="h-5 w-5" aria-hidden="true" />}
            label="Live products"
            value={formatNumber(liveProductCount)}
            hint={`${formatNumber(productCount)} total listed`}
          />
          <StatCard
            icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />}
            label="Total orders"
            value={formatNumber(ordersResult.total)}
          />
          <StatCard
            icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
            label="Gross sales"
            value={formatCurrency(settlementSummary.totalSales)}
          />
          <StatCard
            icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
            label="Net payable"
            value={formatCurrency(settlementSummary.totalPayable)}
          />
          <StatCard
            icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
            label="Pending settlement"
            value={formatCurrency(settlementSummary.pendingEligibleAmount)}
            tone={settlementSummary.pendingEligibleAmount > 0 ? "amber" : "neutral"}
          />
        </StatCardsRow>

        <AlertBannerStack>
          {sellerProfile.sellingStates.length === 0 && (
            <AlertBanner
              tone="amber"
              title="No selling states configured"
              description="This seller's products won't be visible to any state-restricted buyer."
              href={`${basePath}?tab=compliance`}
              linkLabel="Set states"
            />
          )}
          {(!sellerProfile.gstNumber || !sellerProfile.panNumber) && (
            <AlertBanner
              tone="amber"
              title="Missing GST or PAN"
              href={`${basePath}?tab=compliance`}
              linkLabel="Review"
            />
          )}
          {settlementSummary.pendingEligibleAmount > 0 && (
            <AlertBanner
              tone="blue"
              title={`${formatCurrency(settlementSummary.pendingEligibleAmount)} eligible but not yet settled`}
              href={`${basePath}?tab=commissions`}
              linkLabel="Go to settlements"
            />
          )}
        </AlertBannerStack>

        <StatusTabs
          items={
            [
              { key: "overview", label: "Overview", href: `${basePath}?tab=overview` },
              {
                key: "compliance",
                label: "Business & Compliance",
                href: `${basePath}?tab=compliance`,
              },
              {
                key: "catalogue",
                label: "Catalogue & Inventory",
                count: productCount,
                href: `${basePath}?tab=catalogue`,
              },
              {
                key: "orders",
                label: "Orders",
                count: ordersResult.total,
                href: `${basePath}?tab=orders`,
              },
              {
                key: "commissions",
                label: "Commissions & Settlements",
                href: `${basePath}?tab=commissions`,
              },
              { key: "settings", label: "Store Settings", href: `${basePath}?tab=settings` },
              { key: "agreement", label: "Seller Agreement", href: `${basePath}?tab=agreement` },
              { key: "activity", label: "Activity Log", href: `${basePath}?tab=activity` },
            ] satisfies StatusTabItem[]
          }
          activeKey={tab}
        />

        {tab === "overview" && (
          <div className="flex flex-col gap-6">
            <StatCardsRow>
              <StatCard
                icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />}
                label="Orders this month"
                value={formatNumber(monthlyAgg._count._all)}
              />
              <StatCard
                icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
                label="Sales this month"
                value={formatCurrency(Number(monthlyAgg._sum.totalAmount ?? 0))}
              />
            </StatCardsRow>
            <DetailSection title="Recent orders">
              {ordersResult.rows.length === 0 ? (
                <Card className="p-4 text-sm text-gray-600">No orders yet.</Card>
              ) : (
                <div className="flex flex-col gap-3">
                  {ordersResult.rows.slice(0, 5).map((order) => (
                    <Card key={order.id} className="p-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-semibold text-green-700 hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                        <StatusBadge
                          status={order.status}
                          label={ORDER_STATUS_LABEL[order.status]}
                        />
                      </div>
                      <div className="mt-1 text-gray-600">
                        {formatDate(order.createdAt, true)} · Bought by{" "}
                        {getFullName(order.customer) ?? order.customer.phone ?? "—"}
                      </div>
                      <div className="mt-1 font-semibold text-ink">
                        {formatCurrency(
                          (order.charge
                            ? order.charge.customerPayableTotal
                            : order.totalAmount
                          ).toString(),
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </DetailSection>
          </div>
        )}

        {tab === "compliance" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InfoCard
              title="Company details"
              action={
                <EditSellerBusinessButton
                  profileId={sellerProfile.id}
                  companyName={sellerProfile.shopName}
                  contactPersonName={sellerProfile.contactPersonName}
                  companyWebsite={sellerProfile.companyWebsite}
                  registeredAddress={sellerProfile.registeredAddress}
                  contactEmail={sellerProfile.contactEmail}
                  contactMobile={sellerProfile.contactMobile}
                  gstNumber={sellerProfile.gstNumber}
                  panNumber={sellerProfile.panNumber}
                  bankName={sellerProfile.bankName}
                  accountHolder={sellerProfile.accountHolder}
                  accountNumber={sellerProfile.accountNumber}
                  ifscCode={sellerProfile.ifscCode}
                  bankBranch={sellerProfile.bankBranch}
                  sellingStateIds={sellerProfile.sellingStates.map((s) => s.id)}
                  allStates={allStates}
                />
              }
            >
              <KeyValue label="Company name" value={sellerProfile.shopName} />
              <KeyValue label="Contact person" value={sellerProfile.contactPersonName ?? "—"} />
              <KeyValue
                label="Website"
                value={
                  sellerProfile.companyWebsite ? (
                    <a
                      href={sellerProfile.companyWebsite}
                      target="_blank"
                      rel="noreferrer"
                      className="text-green-700 hover:underline"
                    >
                      {sellerProfile.companyWebsite}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <KeyValue label="Registered address" value={sellerProfile.registeredAddress ?? "—"} />
              <KeyValue
                label="Contact email"
                value={
                  sellerProfile.contactEmail ? (
                    <a
                      href={`mailto:${sellerProfile.contactEmail}`}
                      className="text-green-700 hover:underline"
                    >
                      {sellerProfile.contactEmail}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <KeyValue label="Contact mobile" value={sellerProfile.contactMobile ?? "—"} />
              <KeyValue
                label="States to sell in"
                value={
                  sellerProfile.sellingStates.length > 0
                    ? sellerProfile.sellingStates.map((s) => s.name).join(", ")
                    : "—"
                }
              />
              <KeyValue
                label="Shop slug"
                value={<span className="font-mono text-xs">{sellerProfile.slug}</span>}
              />
            </InfoCard>

            <InfoCard title="GST & bank details">
              <KeyValue label="GST number" value={sellerProfile.gstNumber ?? "—"} />
              <KeyValue label="PAN number" value={sellerProfile.panNumber ?? "—"} />
              <KeyValue
                label="GST certificate"
                value={
                  <DocumentViewerButton
                    url={
                      sellerProfile.gstDocUrl
                        ? `/api/admin/sellers/${sellerProfile.id}/documents/gst`
                        : null
                    }
                    label="GST certificate"
                  />
                }
              />
              <KeyValue
                label="PAN card"
                value={
                  <DocumentViewerButton
                    url={
                      sellerProfile.panDocUrl
                        ? `/api/admin/sellers/${sellerProfile.id}/documents/pan`
                        : null
                    }
                    label="PAN card"
                  />
                }
              />
              <KeyValue label="Bank name" value={sellerProfile.bankName ?? "—"} />
              <KeyValue label="Account holder" value={sellerProfile.accountHolder ?? "—"} />
              <KeyValue label="Account number" value={sellerProfile.accountNumber ?? "—"} />
              <KeyValue label="IFSC code" value={sellerProfile.ifscCode ?? "—"} />
              <KeyValue label="Bank branch" value={sellerProfile.bankBranch ?? "—"} />
            </InfoCard>
          </div>
        )}

        {tab === "catalogue" && (
          <DetailSection title={`Products (${productCount})`}>
            {catalogueProducts.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">No products listed yet.</Card>
            ) : (
              <Card className="divide-y divide-border p-4">
                {catalogueProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="text-ink">{p.name}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={p.customerVisible ? "success" : "neutral"}>
                        {p.customerVisible ? "Customer stock" : "Hidden from customers"}
                      </Badge>
                      <Badge tone={p.dealerVisible ? "success" : "neutral"}>
                        {p.dealerVisible ? "Dealer stock" : "Hidden from dealers"}
                      </Badge>
                      <StatusBadge status={p.lifecycleStatus} />
                    </div>
                  </div>
                ))}
              </Card>
            )}
            {productCount > catalogueProducts.length && (
              <p className="mt-2 text-xs text-gray-500">
                Showing the most recent {catalogueProducts.length} of {productCount} products.
              </p>
            )}
          </DetailSection>
        )}

        {tab === "commissions" && (
          <>
            <DetailSection title="Commission rates">
              <Card className="p-4">
                <p className="mb-3 text-xs text-gray-500">
                  Set independently per buyer type. E.g. on a ₹100 order, a 10% customer commission
                  charges the seller ₹10 while a 5% dealer commission charges ₹5 — the same seller
                  can carry different rates for each.
                </p>
                <SellerCommissionForm
                  profileId={sellerProfile.id}
                  initialCommissionPercent={Number(sellerProfile.commissionPercent)}
                  initialDealerCommissionPercent={Number(sellerProfile.dealerCommissionPercent)}
                />
              </Card>
            </DetailSection>
          </>
        )}

        {tab === "settings" && (
          <DetailSection title="Store settings">
            <Card className="divide-y divide-border p-4">
              <KeyValue
                label="Minimum order amount"
                value={formatCurrency(sellerProfile.minOrderAmount.toString())}
              />
              <KeyValue
                label="Free delivery over"
                value={
                  sellerProfile.freeDeliveryOverAmount
                    ? formatCurrency(sellerProfile.freeDeliveryOverAmount.toString())
                    : "—"
                }
              />
              <KeyValue
                label="Temporarily closed"
                value={sellerProfile.isTemporarilyClosed ? "Yes" : "No"}
              />
              {(sellerProfile.vacationStart || sellerProfile.vacationEnd) && (
                <KeyValue
                  label="Vacation"
                  value={`${sellerProfile.vacationStart ? formatDate(sellerProfile.vacationStart) : "—"} to ${sellerProfile.vacationEnd ? formatDate(sellerProfile.vacationEnd) : "—"}${sellerProfile.vacationNote ? ` · ${sellerProfile.vacationNote}` : ""}`}
                />
              )}
            </Card>
          </DetailSection>
        )}

        {tab === "agreement" && (
          <DetailSection title="Seller agreement">
            <div className="flex flex-col gap-4">
              <Card className="p-4">
                <SellerAgreementUpload
                  sellerProfileId={sellerProfile.id}
                  hasAgreement={!!sellerProfile.agreementStorageKey}
                />
              </Card>
              {sellerProfile.agreementStorageKey ? (
                <SellerAgreementViewer
                  sellerProfileId={sellerProfile.id}
                  fileName={sellerProfile.agreementFileName}
                  uploadedAt={sellerProfile.agreementUploadedAt}
                />
              ) : (
                <Card className="p-4 text-sm text-gray-600">No agreement uploaded yet.</Card>
              )}
            </div>
          </DetailSection>
        )}

        {tab === "orders" && (
          <DetailSection title={`Orders (${ordersResult.total})`}>
            {ordersResult.rows.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">No orders yet.</Card>
            ) : (
              <div className="flex flex-col gap-3">
                {ordersResult.rows.map((order) => (
                  <Card key={order.id} className="p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-semibold text-green-700 hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={order.customerType === "DEALER" ? "warning" : "info"}>
                          {order.customerType === "DEALER" ? "Dealer" : "Customer"} order
                        </Badge>
                        <StatusBadge
                          status={order.status}
                          label={ORDER_STATUS_LABEL[order.status]}
                        />
                      </div>
                    </div>
                    <div className="mt-1 text-gray-600">
                      {formatDate(order.createdAt, true)} · Bought by{" "}
                      {getFullName(order.customer) ?? order.customer.phone ?? "—"}
                    </div>
                    <div className="mt-1 text-gray-600">
                      {order.items
                        .map(
                          (item) =>
                            `${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ""} × ${item.quantity}`,
                        )
                        .join(", ")}
                    </div>
                    <div className="mt-1 text-gray-600">
                      {DELIVERY_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod} ·{" "}
                      {PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
                    </div>
                    <div className="mt-1 font-semibold text-ink">
                      {formatCurrency(
                        (order.charge
                          ? order.charge.customerPayableTotal
                          : order.totalAmount
                        ).toString(),
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
            <SimplePager
              page={ordersPage}
              totalPages={ordersTotalPages}
              paramKey="ordersPage"
              basePath={basePath}
            />
          </DetailSection>
        )}

        {tab === "commissions" && (
          <DetailSection title="Settlements">
            <div className="mb-3 flex justify-end">
              <AnchorButton
                href={`/api/admin/sellers/${id}/settlements/export?${settlementExportParams.toString()}`}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download Excel
              </AnchorButton>
            </div>
            <SettlementSummaryTiles summary={serializeSettlementSummary(settlementSummary)} />
            <AdminSettlementsSection
              rows={commissionResult.rows.map(serializeCommissionRow)}
              total={commissionResult.total}
              page={commissionResult.page}
              pageSize={commissionResult.pageSize}
            />
          </DetailSection>
        )}

        {tab === "activity" && (
          <DetailSection title="Activity log">
            {auditLogRows.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">
                No activity recorded yet for this seller.
              </Card>
            ) : (
              <Card className="divide-y divide-border p-4">
                {auditLogRows.map((entry) => (
                  <div key={entry.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">
                        {entry.action.replaceAll("_", " ")}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatDate(entry.createdAt, true)}
                      </span>
                    </div>
                    {entry.reason && <p className="mt-0.5 text-xs text-gray-600">{entry.reason}</p>}
                  </div>
                ))}
              </Card>
            )}
          </DetailSection>
        )}
      </div>
    </PageContainer>
  );
}
