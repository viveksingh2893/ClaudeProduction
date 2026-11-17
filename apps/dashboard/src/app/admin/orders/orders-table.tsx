"use client";

import Link from "next/link";
import { ArrowRight, FileText, PackageSearch, Truck } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  Badge,
  FilterDrawer,
  IdentityCell,
  OrderItemSummary,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  formatCurrency,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type BadgeTone,
  type DataTableColumn,
} from "@kisan4u/ui";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  DELIVERY_METHOD_LABEL,
} from "@/lib/order-status-labels";
import { AmountEquationBubble } from "@/components/amount-equation-bubble";
import { DispatchWizardLauncher } from "@/components/orders/dispatch-wizard-launcher";
import { AdminInlineStatusControl } from "@/components/orders/admin-inline-status-control";
import { OrderRemarksButton } from "@/components/orders/order-remarks-button";
import { RefundMethodPicker } from "@/components/orders/refund-method-picker";
import type { RefundChoice } from "@kisan4u/orders";
import {
  adminLoadOrderPickupPointsAction,
  adminDispatchViaWizardAction,
  adminLoadOrderAddressAction,
  adminUpdateOrderAddressAction,
} from "./actions";

export type OrderRow = {
  id: string;
  orderNumber: string;
  /** Parent CheckoutGroup's own order number — a single checkout can produce several seller orders (multi-seller cart), so this stays visible on each of that checkout's seller-order rows for tracing. */
  checkoutGroupNumber: string;
  createdAt: Date | string;
  customer: { name: string; phone: string | null };
  /** Name of whoever placed this on the buyer's behalf (a POS staff member, or the BA who prepared it) — see placedByKind. Null for every self-service order. */
  placedBy: string | null;
  /** "POS" (dashboard staff) vs "BA" (Business Associate) vs null (self-service) — see admin-order-row.ts's isPosOrder/isBaOrder. */
  placedByKind: "POS" | "BA" | null;
  seller: { shopName: string };
  deliveryMethod: string;
  status: string;
  paymentMethod: string;
  /** Net of any discount — what the customer is actually billed (OrderCharge.customerPayableTotal). */
  totalAmount: string;
  paidSoFar: string;
  balanceRemaining: string;
  amountEquation: {
    prepaidAmount: string;
    codAmount: string;
    walletAmount: string;
    finalAmount: string;
    discountNote: string | null;
  };
  proofStatus: { label: string; tone: BadgeTone };
  /** POS non-COD order (partial or full prepaid) whose payment-proof screenshot is uploaded but not yet APPROVED — the Payment column shows "Screenshot not approved" instead of the raw payment status. */
  screenshotNotApproved: boolean;
  paymentAllocations: { payment: { status: string } }[];
  firstItem: { name: string; imageUrl: string | null } | null;
  itemCount: number;
  /** Valid next statuses for an ADMIN from this order's current status (canTransition), minus CONFIRMED/CANCELLED for a pending order — those have dedicated flows. Drives the inline "Change status…" select. */
  nextStatuses: { value: string; label: string }[];
  /** True while the order is still Pending — the inline control shows a Confirm/Cancel dropdown instead of the status select. */
  canConfirm: boolean;
  /** True between CONFIRMED and PICKUP_SCHEDULED (no shipment created yet) — the inline control offers "Revert to pending" for when a logistics issue blocks scheduling. */
  canRevertToPending: boolean;
  /** RapidShyp-hosted shipping-label PDF URL once the shipment has one — gates the row's "Download label" action; null for every non-RapidShyp or not-yet-labelled shipment. */
  labelUrl: string | null;
  /** Count of internal remarks on this order — drives the Actions-column Remarks button badge. */
  remarkCount: number;
  /** A cancel / return / RTO refund approved and waiting on the admin to pick a method — the Status column's refund dropdown. Null when there's nothing to refund. */
  refund: {
    refundRequestId: string;
    kind: "Cancellation" | "Return" | "RTO";
    amount: string;
    choices: RefundChoice[];
  } | null;
};

const FILTER_KEYS = [
  "status",
  "customerType",
  "deliveryMethod",
  "paymentStatus",
  "paymentMethod",
  "dateFrom",
  "dateTo",
];

/** Matches the ORDER_STATUSES whitelist in page.tsx — the statuses an admin can realistically filter to from this list (post-delivery return/refund states are handled from the order detail page, not this filter). */
const FILTERABLE_ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAYMENT_PARTIALLY_RECEIVED",
  "CONFIRMED",
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "DELIVERY_FAILED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
];

export function OrdersTable({
  rows,
  total,
  page,
  pageSize,
  viewBasePath = "/admin/orders",
  showInlineStatus = false,
}: {
  rows: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Row links go to `${viewBasePath}/${id}` — the restricted "Payment Verifier" table (/admin/payment-verification) points this at its own minimal detail page instead of the full admin order detail page. */
  viewBasePath?: string;
  /** Show the inline status-change control in the Actions column — true only on /admin/orders, not the Returns or Payment-Verifier tables. */
  showInlineStatus?: boolean;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<OrderRow>[] = [
    {
      key: "orderNumber",
      header: "Order",
      primary: true,
      sortable: true,
      value: (o) => o.orderNumber,
      render: (o) => (
        <div className="flex flex-col">
          <span className="font-semibold text-ink">{o.orderNumber}</span>
          <span className="text-xs text-gray-500" title="Parent checkout">
            {o.checkoutGroupNumber}
          </span>
          <span className="text-xs text-gray-400">{formatDate(o.createdAt)}</span>
        </div>
      ),
    },
    {
      key: "item",
      header: "Item",
      value: (o) => o.firstItem?.name ?? "",
      render: (o) =>
        o.firstItem ? (
          <div className="max-w-[130px]">
            <OrderItemSummary
              size="sm"
              imageUrl={o.firstItem.imageUrl}
              name={o.firstItem.name}
              variantLabel={
                o.itemCount > 1
                  ? `+${o.itemCount - 1} more item${o.itemCount - 1 > 1 ? "s" : ""}`
                  : null
              }
            />
          </div>
        ) : (
          <span className="text-gray-400">—</span>
        ),
      mobileHidden: true,
    },
    {
      key: "customer",
      header: "Customer",
      sortable: true,
      value: (o) => o.customer.name,
      // "Placed by" folds in here as a subtitle line — it's non-null only
      // for the minority of orders placed via POS or a Business Associate
      // on a customer's behalf, so it never earned its own always-visible
      // column.
      render: (o) => (
        <IdentityCell
          name={o.customer.name}
          subtitle={[
            o.customer.phone,
            o.placedBy
              ? `via ${o.placedByKind === "BA" ? "BA" : "POS"}: ${o.placedBy}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
    },
    {
      key: "seller",
      header: "Seller",
      sortable: true,
      value: (o) => o.seller.shopName,
      // Delivery method folds in here as a subtitle rather than its own
      // column — same reasoning as "Placed by" above.
      render: (o) => (
        <div className="flex flex-col">
          <span className="text-gray-700">{o.seller.shopName}</span>
          <span className="text-[11px] text-gray-400">
            {DELIVERY_METHOD_LABEL[o.deliveryMethod] ?? o.deliveryMethod}
          </span>
        </div>
      ),
      mobileHidden: true,
    },
    {
      key: "payment",
      header: "Payment",
      render: (o) => {
        if (o.screenshotNotApproved) {
          return <Badge tone="warning">Screenshot not approved</Badge>;
        }
        const paymentStatus = o.paymentAllocations[0]?.payment.status;
        return paymentStatus ? (
          <StatusBadge status={paymentStatus} label={PAYMENT_STATUS_LABEL[paymentStatus]} />
        ) : (
          <span className="text-gray-400">—</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (o) => o.status,
      render: (o) =>
        showInlineStatus && o.refund ? (
          <div className="flex flex-col items-start gap-1.5">
            <StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} />
            <RefundMethodPicker
              sellerOrderId={o.id}
              refundRequestId={o.refund.refundRequestId}
              kind={o.refund.kind}
              amount={o.refund.amount}
              choices={o.refund.choices}
              compact
            />
          </div>
        ) : (
          <StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} />
        ),
    },
    {
      key: "proof",
      header: "Proof",
      value: (o) => o.proofStatus.label,
      render: (o) =>
        o.proofStatus.label === "—" ? (
          <span className="text-gray-400">—</span>
        ) : (
          <Badge tone={o.proofStatus.tone}>{o.proofStatus.label}</Badge>
        ),
      hideBelow: "lg",
      mobileHidden: true,
    },
    {
      key: "total",
      header: "Amount",
      align: "right",
      sortable: true,
      value: (o) => Number(o.totalAmount),
      render: (o) => <AmountEquationBubble equation={o.amountEquation} />,
    },
    {
      key: "balance",
      header: "Paid / Balance",
      align: "right",
      value: (o) => Number(o.balanceRemaining),
      render: (o) => (
        <div className="flex flex-col text-[11px]">
          <span className="text-success">Paid {formatCurrency(o.paidSoFar)}</span>
          <span className={Number(o.balanceRemaining) > 0 ? "font-semibold text-ink" : "text-gray-400"}>
            {Number(o.balanceRemaining) > 0
              ? `Due ${formatCurrency(o.balanceRemaining)}`
              : "Fully collected"}
          </span>
        </div>
      ),
      hideBelow: "lg",
      mobileHidden: true,
    },
  ];

  return (
    <AdminDataTable
      data={rows}
      columns={columns}
      rowKey={(o) => o.id}
      renderActions={(o) => (
        <div className="flex items-center gap-1">
          <Link
            href={`${viewBasePath}/${o.id}`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold text-green-700 transition-colors hover:bg-green-50"
          >
            View
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          {showInlineStatus && (
            <OrderRemarksButton
              sellerOrderId={o.id}
              orderNumber={o.orderNumber}
              count={o.remarkCount}
            />
          )}
          {showInlineStatus && (
            <AdminInlineStatusControl
              sellerOrderId={o.id}
              nextStatuses={o.nextStatuses}
              canConfirm={o.canConfirm}
              canRevertToPending={o.canRevertToPending}
            />
          )}
          {o.status === "CONFIRMED" && o.deliveryMethod === "KISAN4U_COURIER" && (
            <DispatchWizardLauncher
              sellerOrderId={o.id}
              orderNumber={o.orderNumber}
              paymentMethod={o.paymentMethod}
              codAmount={o.paymentMethod === "COD" ? Number(o.balanceRemaining) : undefined}
              loadPickupPoints={adminLoadOrderPickupPointsAction}
              submit={adminDispatchViaWizardAction}
              loadAddress={adminLoadOrderAddressAction}
              updateAddress={adminUpdateOrderAddressAction}
            />
          )}
          {o.labelUrl && (
            <a
              href={`/api/admin/orders/${o.id}/label`}
              target="_blank"
              rel="noopener noreferrer"
              title="Download shipping label"
              className="inline-flex items-center rounded-md p-1.5 text-gray-500 transition-colors hover:bg-green-50 hover:text-green-700"
            >
              <Truck className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <a
            href={`/api/admin/orders/${o.id}/invoice`}
            target="_blank"
            rel="noopener noreferrer"
            title="Download invoice"
            className="inline-flex items-center rounded-md p-1.5 text-gray-500 transition-colors hover:bg-green-50 hover:text-green-700"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
      caption="Orders"
      searchPlaceholder="Order number, phone, or name…"
      server={{
        totalItems: total,
        page,
        pageSize,
        onPageChange: table.setPage,
        onPageSizeChange: table.setPageSize,
        searchValue: table.searchInput,
        onSearchChange: table.setSearchInput,
        onSearchSubmit: table.submitSearch,
        sortKey: table.sortKey,
        sortDir: table.sortDir,
        onSortChange: table.setSort,
      }}
      hasActiveFilters={activeFilterCount > 0}
      filters={
        <FilterDrawer count={activeFilterCount}>
          <TableFilterSelect
            paramKey="status"
            label="Any status"
            options={FILTERABLE_ORDER_STATUSES.map((value) => ({
              value,
              label: ORDER_STATUS_LABEL[value] ?? value,
            }))}
          />
          <TableFilterSelect
            paramKey="customerType"
            label="Any customer type"
            options={[
              { value: "CUSTOMER", label: "Customer" },
              { value: "DEALER", label: "Dealer" },
            ]}
          />
          <TableFilterSelect
            paramKey="deliveryMethod"
            label="Any delivery method"
            options={[
              { value: "KISAN4U_COURIER", label: "Kisan4U Courier" },
              { value: "TRANSPORT", label: "Transport" },
            ]}
          />
          <TableFilterSelect
            paramKey="paymentStatus"
            label="Any payment status"
            options={Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <TableFilterSelect
            paramKey="paymentMethod"
            label="Any payment method"
            options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Placed" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<PackageSearch className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No orders yet"
      emptyDescription="Orders will appear here once customers start checking out."
    />
  );
}
