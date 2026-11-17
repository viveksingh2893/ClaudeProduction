import type {
  OrderStatus,
  PaymentStatus,
  SettlementStatus,
  PaymentMethod,
  UserRole,
} from "@kisan4u/db";
import { AWAITING_DELIVERY, type SettlementFilters, type CommissionFilters } from "@kisan4u/orders";

const ORDER_STATUS_VALUES: OrderStatus[] = [
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
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_REJECTED",
  "REPLACEMENT_APPROVED",
  "REPLACEMENT_DISPATCHED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "RTO_INITIATED",
  "RTO_DELIVERED_TO_SELLER",
  "CLOSED",
];
const PAYMENT_STATUS_VALUES: PaymentStatus[] = [
  "PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
];
const SETTLEMENT_STATUS_VALUES: SettlementStatus[] = [
  "PENDING",
  "ON_HOLD",
  "ELIGIBLE",
  "PROCESSING",
  "SETTLED",
  "PARTIALLY_SETTLED",
  "REVERSED",
  "FAILED",
  "NEEDS_REVIEW",
];
const PAYMENT_METHOD_VALUES: PaymentMethod[] = [
  "COD",
  "ONLINE_FULL",
  "ONLINE_PARTIAL",
  "WALLET",
  "TRANSPORT_FULL_ONLINE",
];
const CUSTOMER_TYPE_VALUES: UserRole[] = ["CUSTOMER", "DEALER"];

/**
 * Single source of truth for turning raw searchParams (a page's
 * `searchParams` prop or a Route Handler's `request.nextUrl.searchParams`)
 * into a validated SettlementFilters — used by the seller Settlement page,
 * the admin seller-detail Settlements section, and both Excel export
 * routes, so the whitelist of valid enum values only ever lives in one
 * place.
 */
export function parseSettlementFilters(sp: Record<string, string | undefined>): SettlementFilters {
  return {
    search: sp.q,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    orderStatus: ORDER_STATUS_VALUES.includes(sp.orderStatus as OrderStatus)
      ? (sp.orderStatus as OrderStatus)
      : undefined,
    financialStatus: PAYMENT_STATUS_VALUES.includes(sp.financialStatus as PaymentStatus)
      ? (sp.financialStatus as PaymentStatus)
      : undefined,
    transactionStatus: SETTLEMENT_STATUS_VALUES.includes(sp.transactionStatus as SettlementStatus)
      ? (sp.transactionStatus as SettlementStatus)
      : undefined,
    paymentMethod: PAYMENT_METHOD_VALUES.includes(sp.paymentMethod as PaymentMethod)
      ? (sp.paymentMethod as PaymentMethod)
      : undefined,
    customerType: CUSTOMER_TYPE_VALUES.includes(sp.customerType as UserRole)
      ? (sp.customerType as UserRole)
      : undefined,
    cyclePayoutKey: /^\d{4}-\d{2}-\d{2}$/.test(sp.cycle ?? "") ? sp.cycle : undefined,
    sortKey: sp.sort,
    sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page: Math.max(1, Number(sp.page) || 1),
    pageSize: [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20,
  };
}

const TRANSACTION_STATUS_WITH_AWAITING: string[] = [...SETTLEMENT_STATUS_VALUES, AWAITING_DELIVERY];

/**
 * Same whitelist source as parseSettlementFilters above, for the item-level
 * commission table (listCommissionTableRows) instead of the delivered-only
 * settlement ledger — orderStatus filters the order's LIVE status (matching
 * /seller/orders), and transactionStatus additionally accepts
 * "AWAITING_DELIVERY" so a seller/admin can filter to not-yet-delivered
 * items.
 */
export function parseCommissionFilters(sp: Record<string, string | undefined>): CommissionFilters {
  return {
    search: sp.q,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    orderStatus: ORDER_STATUS_VALUES.includes(sp.orderStatus as OrderStatus)
      ? (sp.orderStatus as OrderStatus)
      : undefined,
    financialStatus: PAYMENT_STATUS_VALUES.includes(sp.financialStatus as PaymentStatus)
      ? (sp.financialStatus as PaymentStatus)
      : undefined,
    transactionStatus: TRANSACTION_STATUS_WITH_AWAITING.includes(sp.transactionStatus ?? "")
      ? (sp.transactionStatus as SettlementStatus | typeof AWAITING_DELIVERY)
      : undefined,
    paymentMethod: PAYMENT_METHOD_VALUES.includes(sp.paymentMethod as PaymentMethod)
      ? (sp.paymentMethod as PaymentMethod)
      : undefined,
    customerType: CUSTOMER_TYPE_VALUES.includes(sp.customerType as UserRole)
      ? (sp.customerType as UserRole)
      : undefined,
    cyclePayoutKey: /^\d{4}-\d{2}-\d{2}$/.test(sp.cycle ?? "") ? sp.cycle : undefined,
    sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page: Math.max(1, Number(sp.page) || 1),
    pageSize: [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20,
  };
}

export function searchParamsToRecord(sp: URLSearchParams): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of sp.entries()) record[key] = value;
  return record;
}
