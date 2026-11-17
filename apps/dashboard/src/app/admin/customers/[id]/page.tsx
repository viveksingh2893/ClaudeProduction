import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, IndianRupee, ShoppingBag, Wallet } from "lucide-react";
import { prisma, getFullName } from "@kisan4u/db";
import {
  listSellerOrdersForAdmin,
  getWalletSummary,
  resolveOrderItemImageUrls,
} from "@kisan4u/orders";
import {
  ActiveBadge,
  Badge,
  Card,
  OrderItemSummary,
  PageContainer,
  PageHeader,
  StatusBadge,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
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
import { UserActiveAction } from "../../user-active-action";
import { AddWalletMoney } from "../../add-wallet-money";
import { ConvertToDealerButton } from "../convert-to-dealer-button";
import { ChangeStateButton } from "./change-state-button";

const ORDERS_PAGE_SIZE = 10;
const TAB_VALUES = new Set(["orders", "addresses", "wallet", "wishlist", "activity"]);

export default async function AdminCustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ordersPage?: string; tab?: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { id } = await params;
  const sp = await searchParams;
  const ordersPage = Math.max(1, Number(sp.ordersPage) || 1);
  const tab = TAB_VALUES.has(sp.tab ?? "") ? sp.tab! : "orders";

  // Sensitive fields (passwordHash, sessionVersion) are deliberately never
  // selected — this is a strict allow-list, not an exclude-list, so a
  // future column added to User can never leak here by accident.
  const customer = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      isPhoneVerified: true,
      isEmailVerified: true,
      referralCode: true,
      createdAt: true,
      stateId: true,
      indianState: { select: { name: true } },
      accountDeletionRequests: {
        where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
        orderBy: { requestedAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!customer || customer.role !== "CUSTOMER") notFound();
  const customerName = getFullName(customer) ?? customer.phone ?? "—";

  const activeStates = await prisma.indianState.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // A customer can carry a PENDING / REJECTED DealerProfile from a
  // "become a dealer" application — prefill the convert form from it and
  // relabel the button accordingly.
  const existingDealerApplication = await prisma.dealerProfile.findUnique({
    where: { userId: id },
    select: {
      status: true,
      storeName: true,
      storeAddress: true,
      city: true,
      stateId: true,
      pincode: true,
      gstNumber: true,
      licenseNumber: true,
    },
  });

  const [
    addresses,
    wallet,
    ordersResult,
    reviews,
    wishlist,
    cart,
    refundRequests,
    couponRedemptions,
    lifetimeAgg,
  ] = await Promise.all([
    prisma.customerAddress.findMany({
      where: { userId: id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
    getWalletSummary(id, "CUSTOMER"),
    listSellerOrdersForAdmin({
      customerId: id,
      page: ordersPage,
      pageSize: ORDERS_PAGE_SIZE,
      sortKey: "createdAt",
      sortDir: "desc",
    }),
    prisma.productReview.findMany({
      where: { customerId: id },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true, slug: true } } },
    }),
    prisma.wishlistItem.findMany({
      where: { userId: id },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: { product: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.cartItem.findMany({
      where: { userId: id },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { name: true } },
        variant: { select: { sku: true } },
        seller: { select: { shopName: true } },
      },
    }),
    prisma.refundRequest.findMany({
      where: { customerId: id },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.couponRedemption.findMany({
      where: { userId: id },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { coupon: { select: { code: true } } },
    }),
    prisma.sellerOrder.aggregate({
      where: { customerId: id },
      _sum: { totalAmount: true },
      _max: { createdAt: true },
    }),
  ]);

  const ordersTotalPages = Math.max(1, Math.ceil(ordersResult.total / ORDERS_PAGE_SIZE));
  const basePath = `/admin/customers/${id}`;
  const imageByItemId = new Map(
    [
      ...(await resolveOrderItemImageUrls(
        ordersResult.rows.flatMap((order) => order.items.map((item) => ({ ...item, key: item.id }))),
      )),
    ].map(([key, url]) => [key, resolveStorefrontAssetUrl(url)]),
  );

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <Link
        href="/admin/customers"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All customers
      </Link>
      <PageHeader
        title={customerName}
        description={`Customer since ${formatDate(customer.createdAt)}${customer.phone ? ` · ${customer.phone}` : ""}${customer.email ? ` · ${customer.email}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActiveBadge active={customer.isActive} />
            <EditDetailsButton
              userId={customer.id}
              firstName={customer.firstName}
              lastName={customer.lastName}
              email={customer.email}
              phone={customer.phone}
            />
            <ChangeStateButton
              customerId={customer.id}
              customerName={customerName}
              currentStateName={customer.indianState?.name ?? null}
              states={activeStates}
            />
            <ConvertToDealerButton
              userId={customer.id}
              customerName={customerName}
              states={activeStates}
              applicationStatus={existingDealerApplication?.status ?? "NONE"}
              prefill={
                existingDealerApplication
                  ? {
                      storeName: existingDealerApplication.storeName ?? "",
                      storeAddress: existingDealerApplication.storeAddress ?? "",
                      city: existingDealerApplication.city ?? "",
                      stateId: existingDealerApplication.stateId ?? "",
                      pincode: existingDealerApplication.pincode ?? "",
                      gstNumber: existingDealerApplication.gstNumber ?? "",
                      licenseNumber: existingDealerApplication.licenseNumber ?? "",
                    }
                  : undefined
              }
            />
            <UserActiveAction
              userId={customer.id}
              userName={customerName}
              isActive={customer.isActive}
              deletionStatus={toActiveDeletionStatus(
                customer.accountDeletionRequests[0]?.status,
              )}
            />
          </div>
        }
      />

      <StatCardsRow>
        <StatCard icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />} label="Total orders" value={formatNumber(ordersResult.total)} />
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Total spent"
          value={formatCurrency(Number(lifetimeAgg._sum.totalAmount ?? 0))}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
          label="Wallet balance"
          value={formatCurrency(wallet.balance)}
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Last order"
          value={lifetimeAgg._max.createdAt ? formatDate(lifetimeAgg._max.createdAt) : "—"}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {!customer.stateId && (
          <AlertBanner
            tone="amber"
            title="No state selected"
            description="This customer can't see state-restricted products until a state is set."
          />
        )}
        {!customer.isPhoneVerified && (
          <AlertBanner tone="amber" title="Phone number not verified" />
        )}
      </AlertBannerStack>

      <div className="mb-4">
        <DetailSection title="Account summary">
          <Card className="divide-y divide-border p-4">
            <KeyValue
              label="Customer ID"
              value={<span className="font-mono text-xs">{customer.id}</span>}
            />
            <KeyValue label="Full name" value={customerName} />
            <KeyValue label="Phone" value={customer.phone ?? "—"} />
            <KeyValue label="Email" value={customer.email ?? "—"} />
            <KeyValue label="Phone verified" value={customer.isPhoneVerified ? "Yes" : "No"} />
            <KeyValue label="Email verified" value={customer.isEmailVerified ? "Yes" : "No"} />
            <KeyValue label="Registered" value={formatDate(customer.createdAt, true)} />
            <KeyValue label="Referral code" value={customer.referralCode} />
            <KeyValue label="State" value={customer.indianState?.name ?? "Not selected"} />
          </Card>
        </DetailSection>
      </div>

      <StatusTabs
        items={
          [
            { key: "orders", label: "Orders", count: ordersResult.total, href: `${basePath}?tab=orders` },
            { key: "addresses", label: "Addresses", count: addresses.length, href: `${basePath}?tab=addresses` },
            { key: "wallet", label: "Wallet", href: `${basePath}?tab=wallet` },
            { key: "wishlist", label: "Wishlist", count: wishlist.length, href: `${basePath}?tab=wishlist` },
            { key: "activity", label: "Activity", href: `${basePath}?tab=activity` },
          ] satisfies StatusTabItem[]
        }
        activeKey={tab}
      />

      <div className="mt-4 flex flex-col gap-8">
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
                  <div className="mt-2 flex flex-col gap-2">
                    {order.items.map((item) => (
                      <OrderItemSummary
                        key={item.id}
                        size="md"
                        imageUrl={imageByItemId.get(item.id)}
                        name={item.productName}
                        variantLabel={item.variantLabel}
                        quantity={item.quantity}
                      />
                    ))}
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

        {tab === "wallet" && (
        <DetailSection title="Wallet">
          <Card className="flex items-center justify-between p-4">
            <KeyValue label="Balance" value={formatCurrency(wallet.balance)} emphasis />
            <AddWalletMoney userId={customer.id} role="CUSTOMER" ownerName={customerName} />
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

        {tab === "wishlist" && (
        <DetailSection title="Wishlist">
          {wishlist.length === 0 ? (
            <Card className="p-4 text-sm text-gray-600">No wishlist items.</Card>
          ) : (
            <Card className="divide-y divide-border p-4">
              {wishlist.map((w) => (
                <div key={w.id} className="py-1.5 text-sm text-ink">
                  {w.product.name}
                </div>
              ))}
            </Card>
          )}
        </DetailSection>
        )}

        {tab === "activity" && (
        <>
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
                      <span className="text-gray-500">{formatCurrency(r.amount.toString())}</span>
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
