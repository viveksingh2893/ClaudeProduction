/** Plain-language labels for OrderStatus — never rely on color alone to show status (Phase 4 spec §Y). */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  // Sits here from placement until the Kisan4U team confirms the order with
  // the customer, whatever the payment method. Payment state is shown
  // separately.
  PENDING_PAYMENT: "Pending",
  // Still awaiting the same team confirmation as PENDING_PAYMENT, but an
  // advance was captured (ONLINE_PARTIAL) -- a distinct milestone, so it gets
  // its own label rather than a second "Pending" row in the status timeline.
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
