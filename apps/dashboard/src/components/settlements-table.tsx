"use client";

import {
  ActiveFilterSummary,
  AdminDataTable,
  Badge,
  FilterDrawer,
  StatusBadge,
  TableFilterDateRange,
  TableFilterSelect,
  Truncate,
  formatCurrency,
  formatDate,
  formatNumber,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
  type DataTableColumn,
} from "@kisan4u/ui";
import { Receipt } from "lucide-react";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
} from "@/lib/order-status-labels";
import { SETTLEMENT_STATUS_LABEL } from "@/lib/settlement-status-labels";
import type { CommissionRow } from "@/lib/settlement-view";

export const SETTLEMENT_FILTER_KEYS = [
  "orderStatus",
  "financialStatus",
  "transactionStatus",
  "paymentMethod",
  "customerType",
  "dateFrom",
  "dateTo",
];

const money = (value: number | null) => (value === null ? "—" : formatCurrency(value));

/**
 * Shared by both the seller Settlement page and the admin seller-detail
 * Settlements section — one row per order item the seller owns (not per
 * settlement), so a PENDING/IN_TRANSIT/etc. order still shows up here with
 * its live order status, exactly matching /seller/orders — see
 * settlement.ts's "Commission table" doc comment. Every settlement-only
 * financial column renders "—" until the item reaches DELIVERED and gets a
 * real calculated settlement. `renderActions` (admin-only reversal/settle)
 * only gets a real action from the caller when `row.settlementId` is set —
 * there's nothing to settle or reverse on a row with no settlement yet.
 */
export function SettlementsTable({
  rows,
  total,
  page,
  pageSize,
  renderActions,
  emptyDescription = "Your order items appear here as soon as they're placed — the financial breakdown fills in once each item is delivered.",
}: {
  rows: CommissionRow[];
  total: number;
  page: number;
  pageSize: number;
  renderActions?: (row: CommissionRow) => React.ReactNode;
  emptyDescription?: string;
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(SETTLEMENT_FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(SETTLEMENT_FILTER_KEYS);

  const columns: DataTableColumn<CommissionRow>[] = [
    {
      key: "orderDateTime",
      header: "Order DateTime",
      sortable: true,
      value: (r) => r.orderDateTime,
      render: (r) => <span className="whitespace-nowrap">{formatDate(r.orderDateTime, true)}</span>,
    },
    {
      key: "orderId",
      header: "Order ID",
      primary: true,
      value: (r) => r.orderId,
      render: (r) => <span className="font-semibold text-ink">{r.orderId}</span>,
    },
    {
      key: "financialStatus",
      header: "Financial Status",
      value: (r) => r.financialStatus,
      render: (r) => (
        <StatusBadge
          status={r.financialStatus}
          label={PAYMENT_STATUS_LABEL[r.financialStatus] ?? r.financialStatus}
        />
      ),
    },
    {
      key: "shippingState",
      header: "Shipping State",
      value: (r) => r.shippingState,
      render: (r) => r.shippingState || "—",
      mobileHidden: true,
    },
    {
      key: "productName",
      header: "Product Name",
      value: (r) => r.productName,
      render: (r) => <Truncate value={r.productName} maxWidth="200px" />,
    },
    {
      key: "shopName",
      header: "Shop Name",
      value: (r) => r.shopName,
      render: (r) => r.shopName,
      mobileHidden: true,
    },
    {
      key: "customerName",
      header: "Customer Name",
      value: (r) => r.customerName,
      render: (r) => r.customerName,
    },
    {
      key: "customerType",
      header: "Customer Type",
      value: (r) => r.customerType,
      render: (r) => (
        <Badge tone={r.customerType === "DEALER" ? "warning" : "info"}>
          {r.customerType === "DEALER" ? "Dealer" : "Customer"}
        </Badge>
      ),
    },
    {
      key: "productPrice",
      header: "Product Price",
      align: "right",
      value: (r) => r.productPrice,
      render: (r) => formatCurrency(r.productPrice),
      mobileHidden: true,
    },
    {
      key: "netSalesAfterDeductions",
      header: "Net Sales After All Deductions",
      align: "right",
      value: (r) => r.netSalesAfterDeductions ?? 0,
      render: (r) => money(r.netSalesAfterDeductions),
      mobileHidden: true,
    },
    {
      key: "fulfilledQty",
      header: "Fulfilled Qty",
      align: "right",
      value: (r) => r.fulfilledQty,
      render: (r) => formatNumber(r.fulfilledQty),
    },
    {
      key: "netSalesExclTax",
      header: "Net Sales (Excl. Tax)",
      align: "right",
      value: (r) => r.netSalesExclTax ?? 0,
      render: (r) => money(r.netSalesExclTax),
      mobileHidden: true,
    },
    {
      key: "orderStatus",
      header: "Order Status",
      value: (r) => r.orderStatus,
      render: (r) => (
        <StatusBadge
          status={r.orderStatus}
          label={ORDER_STATUS_LABEL[r.orderStatus] ?? r.orderStatus}
        />
      ),
    },
    {
      key: "productPriceIncTax",
      header: "Product Price Inc(Tax)",
      align: "right",
      value: (r) => r.productPriceIncTax ?? 0,
      render: (r) => money(r.productPriceIncTax),
      mobileHidden: true,
    },
    {
      key: "totalSales",
      header: "Total Sales",
      align: "right",
      value: (r) => r.totalSales,
      render: (r) => <span className="font-semibold text-ink">{formatCurrency(r.totalSales)}</span>,
    },
    {
      key: "gstRatePercent",
      header: "GST Rate",
      align: "right",
      value: (r) => r.gstRatePercent,
      render: (r) => `${r.gstRatePercent}%`,
      mobileHidden: true,
    },
    {
      key: "gstTax",
      header: "GST Tax",
      align: "right",
      value: (r) => r.gstTax ?? 0,
      render: (r) => money(r.gstTax),
      mobileHidden: true,
    },
    {
      key: "categories",
      header: "Categories",
      value: (r) => r.categories ?? "",
      render: (r) => r.categories ?? "—",
      mobileHidden: true,
    },
    {
      key: "commissionValuePercent",
      header: "Commission Value",
      align: "right",
      value: (r) => r.commissionValuePercent ?? 0,
      render: (r) => (r.commissionValuePercent === null ? "—" : `${r.commissionValuePercent}%`),
      mobileHidden: true,
    },
    {
      key: "grossCommission",
      header: "Gross Commission",
      align: "right",
      value: (r) => r.grossCommission ?? 0,
      render: (r) => money(r.grossCommission),
      mobileHidden: true,
    },
    {
      key: "grossCommissionTax",
      header: "Gross Commission Tax",
      align: "right",
      value: (r) => r.grossCommissionTax ?? 0,
      render: (r) => money(r.grossCommissionTax),
      mobileHidden: true,
    },
    {
      key: "totalShipmentWeightGrams",
      header: "Total Shipment Weight",
      align: "right",
      value: (r) => r.totalShipmentWeightGrams ?? 0,
      render: (r) =>
        r.totalShipmentWeightGrams === null ? "—" : `${formatNumber(r.totalShipmentWeightGrams)} g`,
      mobileHidden: true,
    },
    {
      key: "logisticsSlab",
      header: "Logistics Slab",
      value: (r) => r.logisticsSlab ?? "",
      render: (r) => r.logisticsSlab ?? "—",
      mobileHidden: true,
    },
    {
      key: "logistic",
      header: "Allocated Logistics Charge",
      align: "right",
      value: (r) => r.logistic ?? 0,
      render: (r) => money(r.logistic),
      mobileHidden: true,
    },
    {
      key: "logisticTax",
      header: "Allocated Logistics Tax",
      align: "right",
      value: (r) => r.logisticTax ?? 0,
      render: (r) => money(r.logisticTax),
      mobileHidden: true,
    },
    {
      key: "collectionCharge",
      header: "Allocated Collection Charge",
      align: "right",
      value: (r) => r.collectionCharge ?? 0,
      render: (r) => money(r.collectionCharge),
      mobileHidden: true,
    },
    {
      key: "collectionChargeTax",
      header: "Allocated Collection Tax",
      align: "right",
      value: (r) => r.collectionChargeTax ?? 0,
      render: (r) => money(r.collectionChargeTax),
      mobileHidden: true,
    },
    {
      key: "tcs",
      header: "Tcs",
      align: "right",
      value: (r) => r.tcs ?? 0,
      render: (r) => money(r.tcs),
      mobileHidden: true,
    },
    {
      key: "tds",
      header: "Tds",
      align: "right",
      value: (r) => r.tds ?? 0,
      render: (r) => money(r.tds),
      mobileHidden: true,
    },
    {
      key: "paymentMethod",
      header: "Payment Method",
      value: (r) => r.paymentMethod,
      render: (r) => PAYMENT_METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod,
      mobileHidden: true,
    },
    {
      key: "deliveredAt",
      header: "Delivered On",
      value: (r) => r.deliveredAt ?? "",
      render: (r) => {
        if (r.deliveredAt)
          return <span className="whitespace-nowrap">{formatDate(r.deliveredAt, true)}</span>;
        return r.orderStatus === "DELIVERED" ? (
          <span className="text-gray-500">Not recorded</span>
        ) : (
          "—"
        );
      },
      mobileHidden: true,
    },
    {
      key: "transactionStatus",
      header: "Transaction Status",
      value: (r) => r.transactionStatus,
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge
            status={r.transactionStatus}
            label={SETTLEMENT_STATUS_LABEL[r.transactionStatus] ?? r.transactionStatus}
          />
          {r.adjustmentCount > 0 && (
            <span className="text-[10px] font-semibold text-gray-500">
              {r.adjustmentCount} adjustment(s)
            </span>
          )}
        </div>
      ),
    },
    {
      key: "payableToSeller",
      header: "Payable to seller",
      align: "right",
      value: (r) => r.netPayable ?? 0,
      render: (r) =>
        r.netPayable === null ? (
          "—"
        ) : (
          <span className={`font-bold ${r.netPayable < 0 ? "text-danger" : "text-ink"}`}>
            {formatCurrency(r.netPayable)}
          </span>
        ),
    },
  ];

  return (
    <AdminDataTable
      data={rows}
      columns={columns}
      rowKey={(r) => r.id}
      renderActions={renderActions}
      caption="Seller commission table"
      searchPlaceholder="Search by order ID, product, or customer…"
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
            paramKey="orderStatus"
            label="Any order status"
            options={Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <TableFilterSelect
            paramKey="financialStatus"
            label="Any financial status"
            options={Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <TableFilterSelect
            paramKey="transactionStatus"
            label="Any transaction status"
            options={Object.entries(SETTLEMENT_STATUS_LABEL).map(([value, label]) => ({
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
          <TableFilterSelect
            paramKey="customerType"
            label="Any customer type"
            options={[
              { value: "CUSTOMER", label: "Customer" },
              { value: "DEALER", label: "Dealer" },
            ]}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Order date" />
        </FilterDrawer>
      }
      clearFiltersAction={
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      }
      emptyIcon={<Receipt className="h-8 w-8" aria-hidden="true" />}
      emptyTitle="No orders yet"
      emptyDescription={emptyDescription}
    />
  );
}
