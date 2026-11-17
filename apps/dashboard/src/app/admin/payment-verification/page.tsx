import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { getFullName } from "@kisan4u/db";
import {
  getPosPaymentProofQueueSummary,
  listPosPaymentProofQueue,
  netPayableForOrder,
  type PosPaymentProofTab,
} from "@kisan4u/orders";
import {
  Badge,
  PageContainer,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  formatDate,
} from "@kisan4u/ui";
import { requirePaymentVerificationAccess } from "@/lib/payment-verification-guard";
import { buildOrderAmountEquation, sumOrderAmountEquations } from "@/lib/order-amount-equation";
import { AmountEquationBubble } from "@/components/amount-equation-bubble";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { PaymentVerificationSearchBar } from "./search-bar";

const TAB_VALUES: PosPaymentProofTab[] = ["PENDING", "APPROVED", "REJECTED"];

function waitingLabel(hours: number) {
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The Payment Verification queue's default view — every CHECKOUT GROUP
 * with a screenshot AWAITING review, oldest-waiting first, with
 * Approved/Rejected as separate history tabs. One row = one checkout
 * group, not one screenshot — a buyer paying in instalments has several
 * concurrent screenshots for the same group, and a multi-seller cart has
 * several seller orders under it; both are summarized here and shown in
 * full on the detail page. Deliberately distinct from /admin/orders (the
 * full order list) — a COD order never appears here at all, since no
 * PosPaymentProofSubmission is ever created for one.
 */
export default async function PaymentVerificationOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePaymentVerificationAccess();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const tab: PosPaymentProofTab = TAB_VALUES.includes(sp.tab as PosPaymentProofTab)
    ? (sp.tab as PosPaymentProofTab)
    : "PENDING";

  const [{ rows, total }, summary] = await Promise.all([
    listPosPaymentProofQueue({ tab, search: sp.q, page, pageSize }),
    getPosPaymentProofQueueSummary(),
  ]);

  function tabHref(tabKey: PosPaymentProofTab) {
    const params = new URLSearchParams();
    if (tabKey !== "PENDING") params.set("tab", tabKey);
    return params.toString()
      ? `/admin/payment-verification?${params.toString()}`
      : "/admin/payment-verification";
  }

  const tabs: StatusTabItem[] = [
    { key: "PENDING", label: "Awaiting review", count: summary.pendingCount, href: tabHref("PENDING") },
    { key: "APPROVED", label: "Completed", count: summary.approvedCount, href: tabHref("APPROVED") },
    { key: "REJECTED", label: "Rejected", count: summary.rejectedCount, href: tabHref("REJECTED") },
  ];

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <PageHeader
        title="Payment Verification"
        description="Uploaded payment screenshots awaiting review — Cash on Delivery orders never appear here, there's nothing to verify."
      />

      <StatCardsRow>
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Awaiting review"
          value={summary.pendingCount}
          tone={summary.pendingCount > 0 ? "amber" : "neutral"}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Overdue (24h+)"
          value={summary.overdueCount}
          tone={summary.overdueCount > 0 ? "red" : "neutral"}
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Completed"
          value={summary.approvedCount}
          tone="green"
        />
        <StatCard
          icon={<XCircle className="h-5 w-5" aria-hidden="true" />}
          label="Rejected"
          value={summary.rejectedCount}
          tone="red"
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.overdueCount > 0 && (
          <AlertBanner
            tone="red"
            title={`${summary.overdueCount} order${summary.overdueCount === 1 ? " has" : "s have"} been waiting 24+ hours`}
            href={tabHref("PENDING")}
            linkLabel="Review now"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />
      <PaymentVerificationSearchBar />

      <TableShell>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Order</TableHeaderCell>
              <TableHeaderCell>Buyer</TableHeaderCell>
              <TableHeaderCell>Placed by</TableHeaderCell>
              <TableHeaderCell align="right">Claimed / split</TableHeaderCell>
              <TableHeaderCell>Screenshots</TableHeaderCell>
              <TableHeaderCell>{tab === "PENDING" ? "Waiting" : "Reviewed"}</TableHeaderCell>
              <TableHeaderCell>&nbsp;</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const equation = sumOrderAmountEquations(
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
              const sellerNames = [...new Set(row.sellerOrders.map((so) => so.seller.shopName))];
              return (
                <TableRow key={row.checkoutGroupId}>
                  <TableCell>
                    <span className="font-semibold text-ink">{row.groupNumber}</span>
                    <p className="text-xs text-gray-500">{formatDate(row.createdAt, true)}</p>
                    {row.sellerOrders.length > 1 && (
                      <p className="text-xs text-gray-500">
                        {row.sellerOrders.length} sellers: {sellerNames.join(", ")}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">
                      {getFullName(row.customer) ?? row.customer.phone ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">
                      {(row.placedByUser && getFullName(row.placedByUser)) ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <div className="text-sm font-semibold text-ink">
                      ₹{row.claimedAmountTotal.toFixed(2)} claimed
                    </div>
                    <AmountEquationBubble
                      equation={{
                        prepaidAmount: equation.prepaidAmount.toFixed(2),
                        codAmount: equation.codAmount.toFixed(2),
                        walletAmount: equation.walletAmount.toFixed(2),
                        finalAmount: equation.finalAmount.toFixed(2),
                        discountNote: equation.discountNote != null ? equation.discountNote.toFixed(2) : null,
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.pendingCount > 0 && <Badge tone="warning">{row.pendingCount} pending</Badge>}
                      {row.approvedCount > 0 && <Badge tone="success">{row.approvedCount} approved</Badge>}
                      {row.rejectedCount > 0 && <Badge tone="danger">{row.rejectedCount} rejected</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {tab === "PENDING" ? (
                      <Badge tone={row.isOverdue ? "danger" : "neutral"}>
                        {waitingLabel(row.waitingHours)}
                      </Badge>
                    ) : (
                      <span className="text-gray-600">
                        {row.latestReviewedAt ? formatDate(row.latestReviewedAt) : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/payment-verification/${row.checkoutGroupId}`}
                      className="text-xs font-bold text-green-700 hover:underline"
                    >
                      {tab === "PENDING" ? "Review & verify" : "View"}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <span className="text-gray-500">
                    {tab === "PENDING" ? "Nothing awaiting review." : "Nothing here yet."}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableShell>
      {total > pageSize && (
        <div className="mt-4 flex justify-center gap-2 text-sm">
          {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => i + 1).map((p) => {
            const params = new URLSearchParams();
            if (tab !== "PENDING") params.set("tab", tab);
            if (sp.q) params.set("q", sp.q);
            if (p !== 1) params.set("page", String(p));
            const href = params.toString()
              ? `/admin/payment-verification?${params.toString()}`
              : "/admin/payment-verification";
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
