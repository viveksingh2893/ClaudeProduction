import Link from "next/link";
import { Ban, CheckCircle2, PackageSearch, ShoppingBag, TrendingDown } from "lucide-react";
import { getFullName } from "@kisan4u/db";
import type { OrderStatus, PaymentMethod } from "@kisan4u/db";
import {
  getPosOrdersSummaryForPlacedBy,
  listCheckoutGroupsForPlacedBy,
  netPayableForOrder,
} from "@kisan4u/orders";
import {
  Badge,
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
  formatDate,
} from "@kisan4u/ui";
import { requirePosAccess } from "@/lib/pos-guard";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-status-labels";
import { posPaymentProofStatusLabel } from "@/lib/pos-payment-proof-status";
import { buildOrderAmountEquation, sumOrderAmountEquations } from "@/lib/order-amount-equation";
import { AmountEquationBubble } from "@/components/amount-equation-bubble";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { PosOrdersFilterBar } from "./filter-bar";

const ORDER_STATUS_VALUES = new Set(Object.keys(ORDER_STATUS_LABEL));
const PAYMENT_METHOD_VALUES = new Set(Object.keys(PAYMENT_METHOD_LABEL));
const TAB_KEYS = ["all", "needsAttention", "active", "delivered", "cancelled"] as const;
type PosOrdersTab = (typeof TAB_KEYS)[number];
const TAB_VALUES = new Set<string>(TAB_KEYS);

/** "Placed by" this exact staff member's own POS orders only — never a general admin filter, same discipline as the seller order list's sellerId scoping (see listCheckoutGroupsForPlacedBy's doc comment). */
export default async function PosOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePosAccess();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tab: PosOrdersTab = TAB_VALUES.has(sp.tab ?? "") ? (sp.tab as PosOrdersTab) : "all";
  const status = ORDER_STATUS_VALUES.has(sp.status ?? "") ? (sp.status as OrderStatus) : undefined;
  const paymentMethod = PAYMENT_METHOD_VALUES.has(sp.paymentMethod ?? "")
    ? (sp.paymentMethod as PaymentMethod)
    : undefined;

  const [{ rows, total, pageSize }, summary] = await Promise.all([
    listCheckoutGroupsForPlacedBy(session.user.id, {
      page,
      search: sp.q,
      status,
      paymentMethod,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      tab: tab === "all" ? undefined : tab,
    }),
    getPosOrdersSummaryForPlacedBy(session.user.id),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function proofStatusLabel(row: (typeof rows)[number]) {
    return posPaymentProofStatusLabel({
      isPosOrder: true, // every row on this page is this staff member's own POS order, by definition
      paymentMethod: row.primaryPayment?.method ?? "COD",
      liveSubmissions: row.liveSubmissions.map((s) => ({ status: s.status })),
    });
  }

  // A checkout group can bundle several sellers' orders behind one payment
  // — sum each seller order's own amount equation into one combined
  // equation for the group row, same math as the admin orders table uses
  // per order (see order-amount-equation.ts).
  function groupEquation(row: (typeof rows)[number]) {
    return sumOrderAmountEquations(
      row.sellerOrders.map((so) =>
        buildOrderAmountEquation({
          paymentMethod: so.paymentMethod,
          netPayable: netPayableForOrder(so),
          discountAmount: so.charge ? Number(so.charge.promotionalDiscountAmount) : 0,
          customerType: so.customerType,
          allocation: so.paymentAllocations[0] ?? null,
        }),
      ),
    );
  }

  function tabHref(key: string) {
    const params = new URLSearchParams();
    if (key !== "all") params.set("tab", key);
    return params.toString() ? `/admin/pos/orders?${params.toString()}` : "/admin/pos/orders";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.totalOrders, href: tabHref("all") },
    {
      key: "needsAttention",
      label: "Needs attention",
      count: summary.needsAttentionOrders,
      href: tabHref("needsAttention"),
    },
    { key: "active", label: "Active", count: summary.activeOrders, href: tabHref("active") },
    {
      key: "delivered",
      label: "Delivered",
      count: summary.deliveredOrders,
      href: tabHref("delivered"),
    },
    {
      key: "cancelled",
      label: "Cancelled",
      count: summary.cancelledOrders,
      href: tabHref("cancelled"),
    },
  ];

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="POS Orders"
        description="Orders you've placed. Upload a payment screenshot from an order's detail page — an admin must approve it before the order can be dispatched."
      />

      <StatCardsRow>
        <StatCard
          icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />}
          label="Total orders"
          value={summary.totalOrders}
        />
        <StatCard
          icon={<PackageSearch className="h-5 w-5" aria-hidden="true" />}
          label="Active orders"
          value={summary.activeOrders}
          tone="blue"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Delivered"
          value={summary.deliveredOrders}
          tone="green"
        />
        <StatCard
          icon={<Ban className="h-5 w-5" aria-hidden="true" />}
          label="Cancelled"
          value={summary.cancelledOrders}
          tone="red"
        />
        <StatCard
          icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
          label="Sales value"
          value={`₹${summary.salesValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          hint={`Cancellation rate ${summary.cancellationRate.toFixed(1)}%`}
          tone={summary.cancellationRate > 10 ? "amber" : "neutral"}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.needsAttentionOrders > 0 && (
          <AlertBanner
            tone="red"
            title={`${summary.needsAttentionOrders} order${summary.needsAttentionOrders === 1 ? "" : "s"} need${summary.needsAttentionOrders === 1 ? "s" : ""} your attention`}
            description="A payment proof was rejected, or a delivery failed / a cancellation was requested."
            href={tabHref("needsAttention")}
            linkLabel="Review"
          />
        )}
        {summary.cancellationRate > 10 && summary.totalOrders >= 5 && (
          <AlertBanner
            tone="amber"
            title={`Cancellation rate is ${summary.cancellationRate.toFixed(1)}%`}
            description="Higher than the 10% guideline — worth a look at recently cancelled orders."
            href={tabHref("cancelled")}
            linkLabel="View cancelled"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />
      <PosOrdersFilterBar />

      <TableShell>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Order</TableHeaderCell>
              <TableHeaderCell>Buyer</TableHeaderCell>
              <TableHeaderCell>Proof</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell align="right">Amount</TableHeaderCell>
              <TableHeaderCell>&nbsp;</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const proof = proofStatusLabel(row);
              const equation = groupEquation(row);
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-semibold text-ink">{row.groupNumber}</span>
                    <p className="text-xs text-gray-500">{formatDate(row.createdAt)}</p>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">
                      {getFullName(row.customer) ?? row.customer.phone ?? "—"}
                    </span>
                    <p className="text-xs text-gray-400">
                      {row.primaryPayment
                        ? (PAYMENT_METHOD_LABEL[row.primaryPayment.method] ??
                          row.primaryPayment.method)
                        : "—"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge tone={proof.tone}>{proof.label}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.distinctStatuses.map((s) => (
                      <StatusBadge key={s} status={s} label={ORDER_STATUS_LABEL[s] ?? s} />
                    ))}
                  </TableCell>
                  <TableCell align="right">
                    <AmountEquationBubble equation={equation} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/pos/orders/${row.id}`}
                        className="text-xs font-bold text-green-700 hover:underline"
                      >
                        View
                      </Link>
                      {/* One invoice per seller order — a direct link only makes sense
                          when this group has exactly one; a multi-seller group's invoices
                          live on the detail page instead, one per seller-order card. */}
                      {row.sellerOrders.length === 1 && (
                        <a
                          href={`/api/pos/orders/${row.sellerOrders[0]!.id}/invoice`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-bold text-green-700 hover:underline"
                        >
                          Invoice
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <span className="text-gray-500">No orders match these filters.</span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableShell>
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2 text-sm">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            const params = new URLSearchParams();
            if (tab !== "all") params.set("tab", tab);
            if (sp.q) params.set("q", sp.q);
            if (status) params.set("status", status);
            if (paymentMethod) params.set("paymentMethod", paymentMethod);
            if (sp.dateFrom) params.set("dateFrom", sp.dateFrom);
            if (sp.dateTo) params.set("dateTo", sp.dateTo);
            if (p !== 1) params.set("page", String(p));
            const href = params.toString() ? `/admin/pos/orders?${params.toString()}` : "/admin/pos/orders";
            return (
              <Link
                key={p}
                href={href}
                className={p === page ? "font-bold text-ink" : "text-gray-500 hover:underline"}
              >
                {p}
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
