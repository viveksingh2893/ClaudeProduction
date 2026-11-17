"use client";

import Link from "next/link";
import { ArrowRight, FileText, PackageSearch, Truck } from "lucide-react";
import {
  ActiveFilterSummary,
  AdminDataTable,
  FilterDrawer,
  OrderItemSummary,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  formatCurrency,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  DELIVERY_METHOD_LABEL,
} from "@/lib/order-status-labels";
import { DispatchWizardLauncher } from "@/components/orders/dispatch-wizard-launcher";
import { SellerInlineStatusControl } from "@/components/orders/seller-inline-status-control";
import { sellerLoadOrderPickupPointsAction, sellerDispatchViaWizardAction } from "./actions";

export type SellerOrderRow = {
  id: string;
  orderNumber: string;
  createdAt: Date | string;
  address: { cityTown: string; state: string; pincode: string } | null;
  deliveryMethod: string;
  paymentMethod: string;
  status: string;
  /** Shipment.provider once one exists ("RAPIDSHYP" | "MOCK"), else null — gates the inline "Mark picked up" action (RapidShyp drives that itself). */
  shipmentProvider: string | null;
  /** Gross — the seller's own settlement basis, unaffected by any customer discount. */
  totalAmount: string;
  discountAmount: string;
  paidSoFar: string;
  balanceRemaining: string;
  firstItem: { name: string; imageUrl: string | null } | null;
  itemCount: number;
  /** True once the shipment has an AWB from a real courier — gates the row's "Download label" action (the label itself is served by /api/seller/orders/[id]/label, never linked directly). */
  hasLabel: boolean;
};

const FILTER_KEYS = ["status", "dateFrom", "dateTo"];

/** Matches the STATUS_VALUES whitelist in page.tsx — the statuses a seller can realistically filter to from this list (post-delivery return/refund states are handled from the order detail page, not this filter), same reasoning as admin/orders/orders-table.tsx's FILTERABLE_ORDER_STATUSES. */
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

export function SellerOrdersTable({
  orders,
  total,
  page,
  pageSize,
  viewBasePath = "/seller/orders",
  showInlineStatus = false,
}: {
  orders: SellerOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Row links go to `${viewBasePath}/${id}` — same reuse pattern as admin/orders/orders-table.tsx's OrdersTable, letting the seller's Returns tab (/seller/returns) link into the exact same order detail page as the regular Orders tab. */
  viewBasePath?: string;
  /** Show the inline one-click status steps in the Actions column — true only on /seller/orders, not the Returns tab. */
  showInlineStatus?: boolean;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  const columns: DataTableColumn<SellerOrderRow>[] = [
    {
      key: "orderNumber",
      header: "Order",
      primary: true,
      sortable: true,
      value: (o) => o.orderNumber,
      render: (o) => (
        <div className="flex flex-col">
          <span className="font-semibold text-ink">{o.orderNumber}</span>
          <span className="text-xs text-gray-500">{formatDate(o.createdAt)}</span>
        </div>
      ),
    },
    {
      key: "item",
      header: "Item",
      value: (o) => o.firstItem?.name ?? "",
      render: (o) =>
        o.firstItem ? (
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
        ) : (
          <span className="text-gray-400">—</span>
        ),
      mobileHidden: true,
    },
    {
      key: "destination",
      header: "Destination",
      value: (o) =>
        o.address ? `${o.address.cityTown}, ${o.address.state} - ${o.address.pincode}` : "",
      render: (o) =>
        o.address ? (
          <span className="text-gray-600">{`${o.address.cityTown}, ${o.address.state} - ${o.address.pincode}`}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: "delivery",
      header: "Delivery",
      value: (o) => DELIVERY_METHOD_LABEL[o.deliveryMethod] ?? o.deliveryMethod,
      render: (o) => (
        <span className="text-gray-600">
          {DELIVERY_METHOD_LABEL[o.deliveryMethod] ?? o.deliveryMethod}
        </span>
      ),
      hideBelow: "lg",
      mobileHidden: true,
    },
    {
      key: "payment",
      header: "Payment",
      value: (o) => PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod,
      render: (o) => (
        <span className="text-gray-600">
          {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}
        </span>
      ),
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (o) => o.status,
      render: (o) => <StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} />,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      value: (o) => Number(o.totalAmount),
      render: (o) => (
        <span className="font-semibold text-ink">{formatCurrency(o.totalAmount)}</span>
      ),
    },
    {
      key: "discount",
      header: "Customer discount",
      align: "right",
      value: (o) => Number(o.discountAmount),
      render: (o) =>
        Number(o.discountAmount) > 0 ? (
          <span className="text-success">−{formatCurrency(o.discountAmount)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
      hideBelow: "lg",
      mobileHidden: true,
    },
    {
      key: "balance",
      header: "Paid / COD due",
      align: "right",
      value: (o) => Number(o.balanceRemaining),
      render: (o) => (
        <div className="flex flex-col text-xs">
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
      data={orders}
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
            <SellerInlineStatusControl
              sellerOrderId={o.id}
              status={o.status}
              deliveryMethod={o.deliveryMethod}
              shipmentProvider={o.shipmentProvider}
            />
          )}
          {o.status === "CONFIRMED" && o.deliveryMethod === "KISAN4U_COURIER" && (
            <DispatchWizardLauncher
              sellerOrderId={o.id}
              orderNumber={o.orderNumber}
              paymentMethod={o.paymentMethod}
              loadPickupPoints={sellerLoadOrderPickupPointsAction}
              submit={sellerDispatchViaWizardAction}
            />
          )}
          {o.hasLabel && (
            <a
              href={`/api/seller/orders/${o.id}/label`}
              target="_blank"
              rel="noopener noreferrer"
              title="Download shipping label"
              className="inline-flex items-center rounded-md p-1.5 text-gray-500 transition-colors hover:bg-green-50 hover:text-green-700"
            >
              <Truck className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <a
            href={`/api/seller/orders/${o.id}/invoice`}
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
      searchPlaceholder="Search by order number…"
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
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Placed" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<PackageSearch className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No orders yet"
      emptyDescription="Orders placed against your products will show up here."
    />
  );
}
