import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_STATUS_LABEL, orderStatusTone } from "./order-status-labels";

const ALL_ORDER_STATUSES = [
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

test("every OrderStatus enum value (packages/db schema.prisma) has a mobile label — a status the badge can't render is worse than a missing feature", () => {
  for (const status of ALL_ORDER_STATUSES) {
    assert.ok(ORDER_STATUS_LABEL[status], `missing label for ${status}`);
  }
});

test("every status resolves to a tone the Badge component supports", () => {
  for (const status of ALL_ORDER_STATUSES) {
    const tone = orderStatusTone(status);
    assert.ok(["success", "warning", "danger", "info", "neutral", "earth"].includes(tone));
  }
});

test("terminal negative statuses render as danger, not success", () => {
  assert.equal(orderStatusTone("CANCELLED"), "danger");
  assert.equal(orderStatusTone("DELIVERY_FAILED"), "danger");
});

test("delivered renders as success", () => {
  assert.equal(orderStatusTone("DELIVERED"), "success");
});
