import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, IndianRupee, ShoppingCart, Star, Wallet as WalletIcon } from "lucide-react";
import { prisma, getFullName } from "@kisan4u/db";
import { listSellerOrdersForAdmin, getWalletSummary } from "@kisan4u/orders";
import {
  ActiveBadge,
  Badge,
  Card,
  PageContainer,
  PageHeader,
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
import { DetailSection, KeyValue, SimplePager } from "@/components/detail-section";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { EditDetailsButton } from "../../edit-account-details-modal";
import { AddWalletMoney } from "../../add-wallet-money";
import {
  DealerDocumentManager,
  EditDealerDetailsButton,
  PendingChangesPanel,
  type DealerProfileCurrent,
} from "../dealer-profile-admin";
import { DealerRowActions } from "../dealer-row-actions";

const ORDERS_PAGE_SIZE = 10;
const TAB_VALUES = new Set(["orders", "addresses", "wallet", "documents", "activity"]);

export default async function AdminDealerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ordersPage?: string; tab?: string }>;
}) {
  await requireSession(["ADMIN"]);
  // Route param is the DealerProfile id (matches the Dealers table's
  // rowKey / DealerStateForm profileId convention), not the User id —
  // resolve the user via the profile's own relation.
  const { id } = await params;
  const sp = await searchParams;
  const ordersPage = Math.max(1, Number(sp.ordersPage) || 1);
  const tab = TAB_VALUES.has(sp.tab ?? "") ? sp.tab! : "orders";

  const dealerProfile = await prisma.dealerProfile.findUnique({
    where: { id },
    include: {
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
      indianState: { select: { name: true } },
    },
  });
  if (!dealerProfile) notFound();
  const { user } = dealerProfile;
  const userName = getFullName(user) ?? user.phone ?? "—";
  const isApproved = dealerProfile.status === "APPROVED";

  const activeStates = await prisma.indianState.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // The full current form — always resubmitted together so a single-field
  // edit (or a re-uploaded document) still passes the dealer form schema.
  const currentProfile: DealerProfileCurrent = {
    name: getFullName(user) ?? "",
    storeName: dealerProfile.storeName ?? "",
    storeAddress: dealerProfile.storeAddress ?? "",
    city: dealerProfile.city ?? "",
    stateId: dealerProfile.stateId ?? "",
    pincode: dealerProfile.pincode ?? "",
    gstNumber: dealerProfile.gstNumber ?? "",
    licenseNumber: dealerProfile.licenseNumber ?? "",
    gstDocUrl: dealerProfile.gstDocUrl ?? "",
    licenseDocUrl: dealerProfile.licenseDocUrl ?? "",
  };
  const pendingChanges =
    dealerProfile.pendingChanges && typeof dealerProfile.pendingChanges === "object"
      ? (dealerProfile.pendingChanges as Record<string, unknown>)
      : null;

  const [
    addresses,
    wallet,
    ordersResult,
    reviews,
    wishlist,
    cart,
    refundRequests,
    couponRedemptions,
    productRequests,
  ] = await Promise.all([
    prisma.customerAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
    getWalletSummary(user.id, "DEALER"),
    listSellerOrdersForAdmin({
      customerId: user.id,
      page: ordersPage,
      pageSize: ORDERS_PAGE_SIZE,
      sortKey: "createdAt",
      sortDir: "desc",
    }),
    prisma.productReview.findMany({
      where: { customerId: user.id },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true, slug: true } } },
    }),
    prisma.wishlistItem.findMany({
      where: { userId: user.id },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: { product: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.cartItem.findMany({
      where: { userId: user.id },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { name: true } },
        variant: { select: { sku: true } },
        seller: { select: { shopName: true } },
      },
    }),
    prisma.refundRequest.findMany({
      where: { customerId: user.id },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.couponRedemption.findMany({
      where: { userId: user.id },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { coupon: { select: { code: true } } },
    }),
    prisma.sellerProductRequest.findMany({
      where: { dealerId: dealerProfile.id },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true } }, seller: { select: { shopName: true } } },
    }),
  ]);
  const lifetimeAgg = await prisma.sellerOrder.aggregate({
    where: { customerId: user.id },
    _sum: { totalAmount: true },
  });

  const ordersTotalPages = Math.max(1, Math.ceil(ordersResult.total / ORDERS_PAGE_SIZE));
  const basePath = `/admin/dealers/${id}`;

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <Link
        href="/admin/dealers"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All dealers
      </Link>
      <PageHeader
        title={userName}
        description={`${dealerProfile.storeName ?? "No store name"} · Dealer since ${formatDate(user.createdAt)}${user.phone ? ` · ${user.phone}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={dealerProfile.status} />
            <ActiveBadge active={user.isActive} />
            <EditDetailsButton
              userId={user.id}
              firstName={user.firstName}
              lastName={user.lastName}
              email={user.email}
              phone={user.phone}
            />
            <EditDealerDetailsButton
              profileId={dealerProfile.id}
              states={activeStates}
              current={currentProfile}
              isApproved={isApproved}
            />
            <DealerRowActions
              profileId={dealerProfile.id}
              userId={user.id}
              userName={userName}
              isActive={user.isActive}
              status={dealerProfile.status}
              stateId={dealerProfile.stateId}
              states={activeStates}
              deletionStatus={toActiveDeletionStatus(user.accountDeletionRequests[0]?.status)}
            />
          </div>
        }
      />

      <StatCardsRow>
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Lifetime order value"
          value={formatCurrency(Number(lifetimeAgg._sum.totalAmount ?? 0))}
        />
        <StatCard
          icon={<WalletIcon className="h-5 w-5" aria-hidden="true" />}
          label="Wallet balance"
          value={formatCurrency(wallet.balance)}
        />
        <StatCard
          icon={<Star className="h-5 w-5" aria-hidden="true" />}
          label="Loyalty points"
          value={formatNumber(wallet.loyaltyPoints)}
        />
        <StatCard
          icon={<ShoppingCart className="h-5 w-5" aria-hidden="true" />}
          label="Items in current cart"
          value={cart.length}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {dealerProfile.status === "PENDING" && (
          <AlertBanner tone="amber" title="Application pending review" />
        )}
        {dealerProfile.hasMissingDocuments && (
          <AlertBanner
            tone="amber"
            title="Missing document — kept approved (legacy migration)"
            description="Migrated from the legacy site without a recoverable GST or licence document — kept approved since it wasn't their fault. Upload it below to clear this flag."
          />
        )}
        {(!dealerProfile.gstNumber || !dealerProfile.licenseNumber) && (
          <AlertBanner
            tone="amber"
            title="Missing verification documents"
            description={`${!dealerProfile.gstNumber ? "GST" : ""}${!dealerProfile.gstNumber && !dealerProfile.licenseNumber ? " and " : ""}${!dealerProfile.licenseNumber ? "Licence" : ""} not on file.`}
          />
        )}
        {!dealerProfile.stateId && (
          <AlertBanner
            tone="amber"
            title="No service state assigned"
            description="This dealer can't see any state-restricted products until an admin sets one."
          />
        )}
      </AlertBannerStack>

      <div className="mb-4">
        <DetailSection title="Account summary">
          <Card className="divide-y divide-border p-4">
            <KeyValue
              label="Dealer ID"
              value={<span className="font-mono text-xs">{dealerProfile.id}</span>}
            />
            <KeyValue
              label="User ID"
              value={<span className="font-mono text-xs">{user.id}</span>}
            />
            <KeyValue label="Full name" value={userName} />
            <KeyValue label="Phone" value={user.phone ?? "—"} />
            <KeyValue label="Email" value={user.email ?? "—"} />
            <KeyValue label="Phone verified" value={user.isPhoneVerified ? "Yes" : "No"} />
            <KeyValue label="Email verified" value={user.isEmailVerified ? "Yes" : "No"} />
            <KeyValue label="Registered" value={formatDate(user.createdAt, true)} />
            <KeyValue
              label="Application status"
              value={<StatusBadge status={dealerProfile.status} />}
            />
            <KeyValue label="KYC status" value={<StatusBadge status={dealerProfile.kycStatus} />} />
            {dealerProfile.rejectionReason && (
              <KeyValue label="Rejection reason" value={dealerProfile.rejectionReason} />
            )}
            <KeyValue label="Total orders" value={formatNumber(ordersResult.total)} />
          </Card>
        </DetailSection>

        <DetailSection title="Store address & serviceability">
          <Card className="divide-y divide-border p-4">
            <KeyValue label="Store name" value={dealerProfile.storeName ?? "—"} />
            <KeyValue
              label="Store address"
              value={
                dealerProfile.storeAddress
                  ? `${dealerProfile.storeAddress}, ${dealerProfile.city ?? ""} ${dealerProfile.pincode ?? ""}`.trim()
                  : "—"
              }
            />
            <KeyValue
              label="Service state"
              value={dealerProfile.indianState?.name ?? dealerProfile.state ?? "Not set"}
            />
            <p className="pt-2 text-xs text-gray-500">
              A dealer is only shown products available in their assigned service state — use
              "Change state" in the actions menu above to update it.
            </p>
          </Card>
        </DetailSection>
      </div>

      <StatusTabs
        items={
          [
            {
              key: "orders",
              label: "Orders",
              count: ordersResult.total,
              href: `${basePath}?tab=orders`,
            },
            {
              key: "addresses",
              label: "Addresses",
              count: addresses.length,
              href: `${basePath}?tab=addresses`,
            },
            { key: "wallet", label: "Wallet", href: `${basePath}?tab=wallet` },
            { key: "documents", label: "Documents", href: `${basePath}?tab=documents` },
            { key: "activity", label: "Activity", href: `${basePath}?tab=activity` },
          ] satisfies StatusTabItem[]
        }
        activeKey={tab}
      />

      <div className="mt-4 flex flex-col gap-8">
        {tab === "documents" && (
          <DetailSection title="Business & GST details">
            {pendingChanges && (
              <div className="mb-3">
                <PendingChangesPanel profileId={dealerProfile.id} pendingChanges={pendingChanges} />
              </div>
            )}
            <Card className="divide-y divide-border p-4">
              <KeyValue
                label="Unregistered dealer"
                value={dealerProfile.isUnregistered ? "Yes" : "No"}
              />
              <KeyValue label="GST number" value={dealerProfile.gstNumber ?? "—"} />
              <KeyValue
                label="GST document"
                value={
                  <DealerDocumentManager
                    profileId={dealerProfile.id}
                    which="gstDocUrl"
                    label="GST document"
                    currentUrl={dealerProfile.gstDocUrl ?? ""}
                    resolvedUrl={
                      dealerProfile.gstDocUrl
                        ? `/api/admin/dealers/${dealerProfile.id}/documents/gst`
                        : null
                    }
                    current={currentProfile}
                    isApproved={isApproved}
                  />
                }
              />
              <KeyValue label="License number" value={dealerProfile.licenseNumber ?? "—"} />
              <KeyValue
                label="License document"
                value={
                  <DealerDocumentManager
                    profileId={dealerProfile.id}
                    which="licenseDocUrl"
                    label="License document"
                    currentUrl={dealerProfile.licenseDocUrl ?? ""}
                    resolvedUrl={
                      dealerProfile.licenseDocUrl
                        ? `/api/admin/dealers/${dealerProfile.id}/documents/licence`
                        : null
                    }
                    current={currentProfile}
                    isApproved={isApproved}
                  />
                }
              />
            </Card>
          </DetailSection>
        )}

        {tab === "addresses" && (
          <DetailSection title="Saved addresses">
            {addresses.length === 0 ? (
              <Card className="p-4 text-sm text-gray-600">No saved addresses.</Card>
            ) : (
              <div className="flex flex-col gap-3">
                {addresses.map((a) => (
                  <Card key={a.id} className="p-4 text-sm text-ink">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-semibold">{a.fullName}</span>
                      <span className="text-gray-500">· {a.mobile}</span>
                      {a.isDefault && <Badge tone="success">Default</Badge>}
                      <span className="ml-auto text-xs uppercase tracking-wide text-gray-400">
                        {a.addressType}
                      </span>
                    </div>
                    <div className="text-gray-600">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ""}
                      {a.landmark ? `, near ${a.landmark}` : ""}, {a.cityTown}, {a.district},{" "}
                      {a.state} - {a.pincode}
                    </div>
                  </Card>
                ))}
              </div>
            )}
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
                      <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
                    </div>
                    <div className="mt-1 text-gray-600">
                      {formatDate(order.createdAt, true)} · Sold by {order.seller.shopName}
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
                      {order.transportNote ? ` · Transport note: ${order.transportNote}` : ""}
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

        {tab === "wallet" && (
          <DetailSection title="Wallet">
            <Card className="divide-y divide-border p-4">
              <div className="flex items-center justify-between">
                <KeyValue label="Balance" value={formatCurrency(wallet.balance)} emphasis />
                <AddWalletMoney userId={user.id} role="DEALER" ownerName={userName} />
              </div>
              <KeyValue
                label="Loyalty points"
                value={formatNumber(wallet.loyaltyPoints)}
                emphasis
              />
            </Card>
            {wallet.recent.length > 0 && (
              <Card className="divide-y divide-border p-4">
                {wallet.recent.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-gray-600">
                      {t.reason.replaceAll("_", " ")} · {formatDate(t.createdAt, true)}
                    </span>
                    <span
                      className={
                        t.type === "CREDIT"
                          ? "font-semibold text-success"
                          : "font-semibold text-danger"
                      }
                    >
                      {t.type === "CREDIT" ? "+" : "−"}
                      {formatCurrency(t.amount)}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </DetailSection>
        )}

        {tab === "activity" && (
          <>
            {productRequests.length > 0 && (
              <DetailSection title="Seller (Request Seller) requests">
                <Card className="divide-y divide-border p-4">
                  {productRequests.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-ink">
                        {r.product.name} × {r.quantity} — {r.seller.shopName}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                  ))}
                </Card>
              </DetailSection>
            )}

            {reviews.length > 0 && (
              <DetailSection title="Reviews">
                <Card className="divide-y divide-border p-4">
                  {reviews.map((r) => (
                    <div key={r.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink">{r.product.name}</span>
                        <span className="text-gray-500">{"★".repeat(r.rating)}</span>
                      </div>
                      {r.comment && <p className="mt-0.5 text-gray-600">{r.comment}</p>}
                    </div>
                  ))}
                </Card>
              </DetailSection>
            )}

            {wishlist.length > 0 && (
              <DetailSection title="Wishlist">
                <Card className="divide-y divide-border p-4">
                  {wishlist.map((w) => (
                    <div key={w.id} className="py-1.5 text-sm text-ink">
                      {w.product.name}
                    </div>
                  ))}
                </Card>
              </DetailSection>
            )}

            {cart.length > 0 && (
              <DetailSection title="Current cart">
                <Card className="divide-y divide-border p-4">
                  {cart.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-ink">
                        {item.product.name}
                        {item.variant?.sku ? ` (${item.variant.sku})` : ""} × {item.quantity}
                      </span>
                      <span className="text-gray-500">{item.seller.shopName}</span>
                    </div>
                  ))}
                </Card>
              </DetailSection>
            )}

            {(refundRequests.length > 0 || couponRedemptions.length > 0) && (
              <DetailSection title="Refunds & coupons">
                {refundRequests.length > 0 && (
                  <Card className="divide-y divide-border p-4">
                    {refundRequests.map((r) => (
                      <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-ink">{r.reason}</span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={r.status} />
                          <span className="text-gray-500">
                            {formatCurrency(r.amount.toString())}
                          </span>
                        </span>
                      </div>
                    ))}
                  </Card>
                )}
                {couponRedemptions.length > 0 && (
                  <Card className="divide-y divide-border p-4">
                    {couponRedemptions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="font-mono text-xs text-ink">{c.coupon.code}</span>
                        <span className="text-gray-500">{formatDate(c.createdAt)}</span>
                      </div>
                    ))}
                  </Card>
                )}
              </DetailSection>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
