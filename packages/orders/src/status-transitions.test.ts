import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition } from "./status-transitions";

test("the standard happy-path chain is allowed for the right actor at each step", () => {
  // CONFIRMED is now an ADMIN-only deliberate step (Kisan4U scheduling team
  // confirms the order with the customer) — payment succeeding no longer
  // auto-advances the order, and neither the customer nor the seller can
  // confirm it.
  assert.equal(canTransition("PENDING_PAYMENT", "CONFIRMED", "ADMIN"), true);
  assert.equal(canTransition("PENDING_PAYMENT", "CONFIRMED", "CUSTOMER"), false);
  assert.equal(canTransition("PAYMENT_PARTIALLY_RECEIVED", "CONFIRMED", "ADMIN"), true);
  assert.equal(canTransition("CONFIRMED", "SELLER_ACCEPTED", "SELLER"), true);
  assert.equal(canTransition("SELLER_ACCEPTED", "PACKED", "SELLER"), true);
  assert.equal(canTransition("PACKED", "PICKUP_SCHEDULED", "SELLER"), true);
  assert.equal(canTransition("PICKUP_SCHEDULED", "PICKED_UP", "SELLER"), true);
  assert.equal(canTransition("PICKED_UP", "IN_TRANSIT", "SELLER"), true);
  assert.equal(canTransition("IN_TRANSIT", "DELIVERED", "SELLER"), true);
});

test("a seller cannot skip statuses (e.g. CONFIRMED straight to PACKED)", () => {
  assert.equal(canTransition("CONFIRMED", "PACKED", "SELLER"), false);
  assert.equal(canTransition("PENDING_PAYMENT", "SELLER_ACCEPTED", "SELLER"), false);
});

test("a customer cannot perform seller-only transitions", () => {
  assert.equal(canTransition("CONFIRMED", "SELLER_ACCEPTED", "CUSTOMER"), false);
  assert.equal(canTransition("PACKED", "PICKUP_SCHEDULED", "DEALER"), false);
});

test("cancellation request is allowed before transit (CONFIRMED/SELLER_ACCEPTED/PACKED/PICKUP_SCHEDULED)", () => {
  for (const from of ["CONFIRMED", "SELLER_ACCEPTED", "PACKED", "PICKUP_SCHEDULED"] as const) {
    assert.equal(canTransition(from, "CANCELLATION_REQUESTED", "CUSTOMER"), true, from);
  }
});

test("cancellation is blocked once the order reaches PICKED_UP or IN_TRANSIT", () => {
  assert.equal(canTransition("PICKED_UP", "CANCELLATION_REQUESTED", "CUSTOMER"), false);
  assert.equal(canTransition("IN_TRANSIT", "CANCELLATION_REQUESTED", "CUSTOMER"), false);
  assert.equal(canTransition("IN_TRANSIT", "CANCELLATION_REQUESTED", "DEALER"), false);
});

test("only ADMIN may approve/reject a pending cancellation request", () => {
  assert.equal(canTransition("CANCELLATION_REQUESTED", "CANCELLED", "ADMIN"), true);
  assert.equal(canTransition("CANCELLATION_REQUESTED", "CANCELLED", "CUSTOMER"), false);
  assert.equal(canTransition("CANCELLATION_REQUESTED", "CANCELLED", "SELLER"), false);
});

test("a seller may pre-acceptance-reject via CONFIRMED -> CANCELLATION_REQUESTED, but not from later statuses", () => {
  assert.equal(canTransition("CONFIRMED", "CANCELLATION_REQUESTED", "SELLER"), true);
  assert.equal(canTransition("SELLER_ACCEPTED", "CANCELLATION_REQUESTED", "SELLER"), false);
});

test("terminal statuses (DELIVERED, CANCELLED) have no outgoing transitions", () => {
  assert.equal(canTransition("DELIVERED", "IN_TRANSIT", "ADMIN"), false);
  assert.equal(canTransition("CANCELLED", "CONFIRMED", "ADMIN"), false);
});

test("post-delivery return/refund is reachable, admin-decided, and terminates correctly on either branch", () => {
  assert.equal(canTransition("DELIVERED", "RETURN_REQUESTED", "CUSTOMER"), true);
  assert.equal(canTransition("DELIVERED", "RETURN_REQUESTED", "DEALER"), true);
  assert.equal(canTransition("RETURN_REQUESTED", "RETURN_APPROVED", "ADMIN"), true);
  assert.equal(canTransition("RETURN_REQUESTED", "RETURN_REJECTED", "ADMIN"), true);
  // Only ADMIN decides — never the seller or the customer themselves.
  assert.equal(canTransition("RETURN_REQUESTED", "RETURN_APPROVED", "SELLER"), false);
  assert.equal(canTransition("RETURN_REQUESTED", "RETURN_APPROVED", "CUSTOMER"), false);
  assert.equal(canTransition("RETURN_APPROVED", "REFUND_INITIATED", "ADMIN"), true);
  assert.equal(canTransition("REFUND_INITIATED", "REFUND_COMPLETED", "ADMIN"), true);
  // Both ends of the fork are terminal — a rejected return doesn't revert
  // to DELIVERED, and a completed refund has nowhere further to go.
  assert.equal(canTransition("RETURN_REJECTED", "DELIVERED", "ADMIN"), false);
  assert.equal(canTransition("REFUND_COMPLETED", "RETURN_REQUESTED", "ADMIN"), false);
});

test("replacement stays reserved/unreachable; RTO is a carrier-driven path (in transit -> initiated -> back with the seller)", () => {
  assert.equal(canTransition("RETURN_APPROVED", "REPLACEMENT_APPROVED", "ADMIN"), false);
  assert.equal(canTransition("REPLACEMENT_APPROVED", "REPLACEMENT_DISPATCHED", "ADMIN"), false);
  assert.equal(canTransition("REFUND_COMPLETED", "CLOSED", "ADMIN"), false);

  // The courier tracking poller acts as ADMIN.
  assert.equal(canTransition("IN_TRANSIT", "RTO_INITIATED", "ADMIN"), true);
  assert.equal(canTransition("RTO_INITIATED", "RTO_DELIVERED_TO_SELLER", "ADMIN"), true);
  // ...and nobody on the buyer's side can drive it, and it can't be skipped into.
  assert.equal(canTransition("IN_TRANSIT", "RTO_INITIATED", "CUSTOMER"), false);
  assert.equal(canTransition("IN_TRANSIT", "RTO_DELIVERED_TO_SELLER", "ADMIN"), false);
  // Returned to origin is terminal.
  assert.equal(canTransition("RTO_DELIVERED_TO_SELLER", "RTO_INITIATED", "ADMIN"), false);
});
