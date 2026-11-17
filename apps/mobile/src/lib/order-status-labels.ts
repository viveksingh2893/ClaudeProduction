import type { BadgeTone } from "@/components/ui/Badge";

/** Mirrors apps/web/src/lib/order-status-labels.ts exactly — kept as a plain copy (no shared runtime package) since it's presentation-only, not business logic. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Pending",
  PAYMENT_PARTIALLY_RECEIVED: "Advance received",
  CONFIRMED: "Confirmed",
  SELLER_ACCEPTED: "Accepted by seller",
  PACKED: "Packed",
  PICKUP_SCHEDULED: "Pickup scheduled",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery failed",
  CANCELLATION_REQUESTED: "Cancellation requested",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURN_APPROVED: "Return approved",
  RETURN_REJECTED: "Return rejected",
  REPLACEMENT_APPROVED: "Replacement approved",
  REPLACEMENT_DISPATCHED: "Replacement dispatched",
  REFUND_INITIATED: "Refund initiated",
  REFUND_COMPLETED: "Refund completed",
  RTO_INITIATED: "Return to origin initiated",
  RTO_DELIVERED_TO_SELLER: "Returned to seller",
  CLOSED: "Closed",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Payment pending",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  FAILED: "Payment failed",
  CANCELLED: "Payment cancelled",
  REFUND_PENDING: "Refund pending",
  REFUNDED: "Refunded",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  COD: "Cash on Delivery",
  ONLINE_FULL: "Paid in full online",
  ONLINE_PARTIAL: "Partial online payment",
  WALLET: "Kisan4U Wallet",
  TRANSPORT_FULL_ONLINE: "Paid in full online (Transport)",
};

export const DELIVERY_METHOD_LABEL: Record<string, string> = {
  KISAN4U_COURIER: "Kisan4U Courier",
  TRANSPORT: "Transport",
};

const TERMINAL_NEGATIVE = new Set([
  "CANCELLED",
  "DELIVERY_FAILED",
  "RETURN_REJECTED",
  "RTO_INITIATED",
  "RTO_DELIVERED_TO_SELLER",
]);
const TERMINAL_POSITIVE = new Set(["DELIVERED", "CLOSED", "REFUND_COMPLETED"]);
const ATTENTION = new Set(["CANCELLATION_REQUESTED", "RETURN_REQUESTED", "DELIVERY_FAILED"]);

export function orderStatusTone(status: string): BadgeTone {
  if (TERMINAL_NEGATIVE.has(status)) return "danger";
  if (ATTENTION.has(status)) return "warning";
  if (TERMINAL_POSITIVE.has(status)) return "success";
  return "info";
}
