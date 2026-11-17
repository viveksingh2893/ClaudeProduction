import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDelhiveryShipmentStatus } from "@kisan4u/providers";
import { isRepeatOfCurrentShipmentStatus } from "./order-workflow";

// Pure — no database. The (Status, StatusType) pairs below are taken from the
// real Delhivery scan stream of K4U-20260907-8134-S1's full return journey.

test("forward leg (StatusType UD) maps as before", () => {
  assert.equal(resolveDelhiveryShipmentStatus("In Transit", "UD"), "IN_TRANSIT");
  assert.equal(resolveDelhiveryShipmentStatus("Pending", "UD"), "IN_TRANSIT");
  assert.equal(resolveDelhiveryShipmentStatus("Dispatched", "UD"), "IN_TRANSIT");
  assert.equal(resolveDelhiveryShipmentStatus("Delivered", "DL"), "DELIVERED");
  // Manifested is before pickup — nothing to transition to yet.
  assert.equal(resolveDelhiveryShipmentStatus("Manifested", "UD"), undefined);
});

test("every scan on the return leg (StatusType RT) is 'RTO in transit'", () => {
  assert.equal(resolveDelhiveryShipmentStatus("In Transit", "RT"), "RTO_INITIATED");
  assert.equal(resolveDelhiveryShipmentStatus("Pending", "RT"), "RTO_INITIATED");
  // "Dispatched for RTO" — still travelling back, not out for delivery.
  assert.equal(resolveDelhiveryShipmentStatus("Dispatched", "RT"), "RTO_INITIATED");
});

test("the final RTO/DL scan (RETURN Accepted, RD-AC) is 'Return to origin'", () => {
  assert.equal(resolveDelhiveryShipmentStatus("RTO", "DL"), "RTO_DELIVERED_TO_SELLER");
});

test("an RTO status that isn't the final DL scan stays 'in transit'", () => {
  assert.equal(resolveDelhiveryShipmentStatus("RTO", "RT"), "RTO_INITIATED");
  assert.equal(resolveDelhiveryShipmentStatus("RTO", undefined), "RTO_INITIATED");
});

test("pickup / cancellation types and empty statuses are not mapped", () => {
  for (const type of ["PP", "PU", "CN"]) {
    assert.equal(resolveDelhiveryShipmentStatus("In Transit", type), undefined);
  }
  assert.equal(resolveDelhiveryShipmentStatus(undefined, "UD"), undefined);
});

test("re-reporting an RTO / failed-delivery state the order is already in is a no-op", () => {
  assert.equal(isRepeatOfCurrentShipmentStatus("RTO_INITIATED", "RTO_INITIATED"), true);
  assert.equal(isRepeatOfCurrentShipmentStatus("RTO_DELIVERED_TO_SELLER", "RTO_DELIVERED_TO_SELLER"), true);
  assert.equal(isRepeatOfCurrentShipmentStatus("DELIVERY_FAILED", "DELIVERY_FAILED"), true);
});

test("a genuinely new state is not a repeat, and forward statuses keep their own guard", () => {
  assert.equal(isRepeatOfCurrentShipmentStatus("IN_TRANSIT", "RTO_INITIATED"), false);
  assert.equal(isRepeatOfCurrentShipmentStatus("RTO_INITIATED", "RTO_DELIVERED_TO_SELLER"), false);
  // Forward statuses are guarded by advanceShipmentToStatus's sequence index, not this helper.
  assert.equal(isRepeatOfCurrentShipmentStatus("IN_TRANSIT", "IN_TRANSIT"), false);
});
