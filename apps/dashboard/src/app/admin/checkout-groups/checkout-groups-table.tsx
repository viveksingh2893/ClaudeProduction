"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Package } from "lucide-react";
import {
  ActiveFilterSummary,
  Badge,
  FilterDrawer,
  IdentityCell,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableFilterDateRange,
  TableFilterSelect,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  formatCurrency,
  formatDate,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
} from "@kisan4u/ui";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
} from "@/lib/order-status-labels";

export type CheckoutGroupRow = {
  id: string;
  groupNumber: string;
  createdAt: Date | string;
  customerType: "CUSTOMER" | "DEALER";
  customer: { id: string; name: string; phone: string | null; email: string | null };
  state: string | null;
  orderCount: number;
  sellerCount: number;
  itemCount: number;
  totalAmount: number;
  paymentMethod: string | null;
  paymentStatus: string | null;
  paidSoFar: number;
  distinctStatuses: string[];
  needsAttention: boolean;
  sellerOrders: {
    id: string;
    orderNumber: string;
    sellerName: string;
    itemCount: number;
    totalAmount: number;
    status: string;
  }[];
};

const FILTER_KEYS = [
  "status",
  "customerType",
  "state",
  "paymentStatus",
  "paymentMethod",
  "sellerId",
  "dateFrom",
  "dateTo",
];

/** Matches page.tsx's own whitelist — the statuses filterable from this list. */
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

function PaymentCell({ g }: { g: CheckoutGroupRow }) {
  if (!g.paymentMethod) return <span className="text-gray-400">—</span>;
  if (g.paymentMethod === "COD") {
    return (
      <div className="text-sm">
        <div className="text-ink">Cash on Delivery</div>
        <div className="text-xs text-gray-500">{formatCurrency(g.totalAmount)}</div>
      </div>
    );
  }
  const remaining = Math.max(0, g.totalAmount - g.paidSoFar);
  const isPartial = g.paidSoFar > 0 && remaining > 0;
  return (
    <div className="text-sm">
      <div className="text-ink">
        {isPartial ? "Partial prepaid" : (PAYMENT_METHOD_LABEL[g.paymentMethod] ?? g.paymentMethod)}
      </div>
      <div className="text-xs text-gray-500">
        {isPartial
          ? `${formatCurrency(g.paidSoFar)} paid + ${formatCurrency(remaining)} COD`
          : formatCurrency(g.totalAmount)}
      </div>
    </div>
  );
}

function FulfillmentCell({ g }: { g: CheckoutGroupRow }) {
  if (g.distinctStatuses.length === 0) return <span className="text-gray-400">—</span>;
  if (g.distinctStatuses.length === 1) {
    const s = g.distinctStatuses[0]!;
    return <StatusBadge status={s} label={ORDER_STATUS_LABEL[s]} />;
  }
  return (
    <span
      className="inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning"
      title={g.distinctStatuses.map((s) => ORDER_STATUS_LABEL[s] ?? s).join(", ")}
    >
      Mixed status
    </span>
  );
}

function ExpandedSellerOrders({ g }: { g: CheckoutGroupRow }) {
  return (
    <TableRow>
      <TableCell colSpan={8}>
        <div className="rounded-lg border border-border bg-surface-alt/40 p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            Seller orders in this checkout ({g.sellerOrders.length})
          </div>
          <div className="overflow-hidden rounded-md border border-border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="p-2.5">Seller order</th>
                  <th className="p-2.5">Seller</th>
                  <th className="p-2.5 text-right">Items</th>
                  <th className="p-2.5 text-right">Order value</th>
                  <th className="p-2.5">Fulfillment status</th>
                  <th className="p-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {g.sellerOrders.map((so) => (
                  <tr key={so.id} className="border-t border-border">
                    <td className="p-2.5 font-mono text-xs text-ink">{so.orderNumber}</td>
                    <td className="p-2.5 text-ink">{so.sellerName}</td>
                    <td className="p-2.5 text-right text-gray-600">{so.itemCount}</td>
                    <td className="p-2.5 text-right font-semibold text-ink">
                      {formatCurrency(so.totalAmount)}
                    </td>
                    <td className="p-2.5">
                      <StatusBadge status={so.status} label={ORDER_STATUS_LABEL[so.status]} />
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/admin/orders/${so.id}`}
                          className="text-xs font-bold text-green-700 hover:underline"
                        >
                          View order
                        </Link>
                        <a
                          href={`/api/admin/orders/${so.id}/invoice`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-bold text-green-700 hover:underline"
                        >
                          Invoice
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function CheckoutGroupsTable({
  rows,
  total,
  page,
  pageSize,
  sellers,
  states,
}: {
  rows: CheckoutGroupRow[];
  total: number;
  page: number;
  pageSize: number;
  sellers: { id: string; shopName: string }[];
  states: { id: string; name: string }[];
}) {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <input
            type="search"
            value={table.searchInput}
            onChange={(e) => table.setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && table.submitSearch()}
            placeholder="Search checkout, seller order, buyer, phone or seller…"
            aria-label="Search checkout groups"
            className="w-full max-w-md rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-green-600"
          />
          <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
        </div>
        <FilterDrawer count={activeFilterCount}>
          <TableFilterSelect
            paramKey="customerType"
            label="Customer or Dealer"
            options={[
              { value: "CUSTOMER", label: "Customer" },
              { value: "DEALER", label: "Dealer" },
            ]}
          />
          <TableFilterSelect
            paramKey="state"
            label="Any state"
            options={states.map((s) => ({ value: s.name, label: s.name }))}
          />
          <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Placed" />
          <TableFilterSelect
            paramKey="paymentMethod"
            label="Any payment method"
            options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <TableFilterSelect
            paramKey="paymentStatus"
            label="Any payment status"
            options={Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <TableFilterSelect
            paramKey="status"
            label="Any order status"
            options={FILTERABLE_ORDER_STATUSES.map((value) => ({
              value,
              label: ORDER_STATUS_LABEL[value] ?? value,
            }))}
          />
          <TableFilterSelect
            paramKey="sellerId"
            label="Any seller"
            options={sellers.map((s) => ({ value: s.id, label: s.shopName }))}
          />
        </FilterDrawer>
      </div>

      <TableShell>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>&nbsp;</TableHeaderCell>
              <TableHeaderCell>Checkout</TableHeaderCell>
              <TableHeaderCell>Buyer</TableHeaderCell>
              <TableHeaderCell>Composition</TableHeaderCell>
              <TableHeaderCell>Payment</TableHeaderCell>
              <TableHeaderCell align="right">Total / Fulfillment</TableHeaderCell>
              <TableHeaderCell>Placed</TableHeaderCell>
              <TableHeaderCell>&nbsp;</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((g) => {
              const isOpen = expanded.has(g.id);
              return (
                <Fragment key={g.id}>
                  <TableRow className={g.needsAttention ? "bg-danger-bg/30" : undefined}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggle(g.id)}
                        aria-label={isOpen ? "Collapse seller orders" : "Expand seller orders"}
                        className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-ink">{g.groupNumber}</span>
                        {g.needsAttention && <Badge tone="danger">Needs attention</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <IdentityCell
                          name={g.customer.name}
                          subtitle={g.customer.phone ?? g.customer.email ?? undefined}
                        />
                        <Badge tone={g.customerType === "DEALER" ? "warning" : "info"}>
                          {g.customerType === "DEALER" ? "Dealer" : "Customer"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-gray-600">
                        {g.orderCount} order{g.orderCount === 1 ? "" : "s"} · {g.sellerCount} seller
                        {g.sellerCount === 1 ? "" : "s"} · {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
                      </div>
                      {g.state && <div className="text-xs text-gray-400">{g.state}</div>}
                    </TableCell>
                    <TableCell>
                      <PaymentCell g={g} />
                    </TableCell>
                    <TableCell align="right">
                      <div className="font-semibold text-ink">{formatCurrency(g.totalAmount)}</div>
                      <div className="mt-0.5">
                        <FulfillmentCell g={g} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-500">{formatDate(g.createdAt, true)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/admin/checkout-groups/${g.id}`}
                          className="text-xs font-bold text-green-700 hover:underline"
                        >
                          View checkout
                        </Link>
                        <Link
                          href={`/admin/customers/${g.customer.id}`}
                          className="text-xs font-bold text-gray-500 hover:underline"
                        >
                          Buyer
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isOpen && <ExpandedSellerOrders g={g} />}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <Package className="h-8 w-8 text-gray-300" aria-hidden="true" />
                    <span className="font-semibold text-ink">No checkout groups yet</span>
                    <span className="text-sm text-gray-500">
                      Checkout groups will appear here once customers or dealers place orders.
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableShell>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 text-sm">
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .map((p, i, arr) => (
              <span key={p} className="flex items-center gap-2">
                {i > 0 && arr[i - 1]! < p - 1 && <span className="text-gray-400">…</span>}
                <button
                  type="button"
                  onClick={() => table.setPage(p)}
                  className={p === page ? "font-bold text-ink" : "text-gray-500 hover:underline"}
                >
                  {p}
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
