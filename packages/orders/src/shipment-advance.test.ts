import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderStatus } from "@kisan4u/db";
import { isRepeatOfCurrentShipmentStatus, planForwardShipmentSteps } from "./order-workflow";
import { canTransition } from "./status-transitions";

// Pure — no database. Covers the courier-sync walk that crashed the admin
// order page for K4U-20260911-6743-S1 (DELIVERY_FAILED, then RapidShyp DEL).

function stepsOf(current: OrderStatus, target: Parameters<typeof planForwardShipmentSteps>[1]) {
  const plan = planForwardShipmentSteps(current, target);
  assert.ok(plan.ok, plan.ok ? "" : plan.error);
  return plan.steps;
}

// Every step the planner returns must be a transition the state machine
// accepts from the status before it (courier syncs act as ADMIN).
function assertWalkable(current: OrderStatus, steps: OrderStatus[]) {
  let from = current;
  for (const step of steps) {
    assert.ok(canTransition(from, step, "ADMIN"), `${from} → ${step} is not allowed`);
    from = step;
  }
}

test("DELIVERY_FAILED → DELIVERED goes back through IN_TRANSIT", () => {
  const steps = stepsOf("DELIVERY_FAILED", "DELIVERED");
  assert.deepEqual(steps, ["IN_TRANSIT", "DELIVERED"]);
  assertWalkable("DELIVERY_FAILED", steps);
});

test("DELIVERY_FAILED → IN_TRANSIT (re-attempt) is a single step", () => {
  const steps = stepsOf("DELIVERY_FAILED", "IN_TRANSIT");
  assert.deepEqual(steps, ["IN_TRANSIT"]);
  assertWalkable("DELIVERY_FAILED", steps);
});

test("an earlier forward code after a failed attempt still resumes at IN_TRANSIT", () => {
  assert.deepEqual(stepsOf("DELIVERY_FAILED", "PICKED_UP"), ["IN_TRANSIT"]);
});

test("DELIVERY_FAILED → RTO_INITIATED is an allowed courier transition", () => {
  assert.ok(canTransition("DELIVERY_FAILED", "RTO_INITIATED", "ADMIN"));
  assert.ok(canTransition("RTO_INITIATED", "RTO_DELIVERED_TO_SELLER", "ADMIN"));
});

test("RapidShyp RTO codes: RTO_DEL is back with the seller, the rest are on the way", async () => {
  const { resolveRapidShypForwardStatus } = await import("@kisan4u/providers");
  assert.equal(resolveRapidShypForwardStatus("RTO_DEL"), "RTO_DELIVERED_TO_SELLER");
  assert.equal(resolveRapidShypForwardStatus("RTO_INT"), "RTO_INITIATED");
  assert.equal(resolveRapidShypForwardStatus("RTO"), "RTO_INITIATED");
  assert.equal(resolveRapidShypForwardStatus("DEL"), "DELIVERED");
  assert.equal(resolveRapidShypForwardStatus("UND"), "DELIVERY_FAILED");
});

test("a repeat UND on a DELIVERY_FAILED order is not a new event", () => {
  assert.equal(isRepeatOfCurrentShipmentStatus("DELIVERY_FAILED", "DELIVERY_FAILED"), true);
  assert.equal(isRepeatOfCurrentShipmentStatus("DELIVERY_FAILED", "DELIVERED"), false);
});

test("normal forward walks are unchanged", () => {
  assert.deepEqual(stepsOf("IN_TRANSIT", "DELIVERED"), ["DELIVERED"]);
  assert.deepEqual(stepsOf("PICKUP_SCHEDULED", "IN_TRANSIT"), ["PICKED_UP", "IN_TRANSIT"]);
  assertWalkable("PICKUP_SCHEDULED", stepsOf("PICKUP_SCHEDULED", "DELIVERED"));
  // Already there or past it — nothing to do.
  assert.deepEqual(stepsOf("IN_TRANSIT", "PICKED_UP"), []);
  assert.deepEqual(stepsOf("DELIVERED", "DELIVERED"), []);
  assert.deepEqual(stepsOf("RETURN_REQUESTED", "DELIVERED"), []);
});

test("an off-sequence status gets an error, never a walk starting at PACKED", () => {
  for (const current of ["CANCELLED", "RTO_INITIATED", "CONFIRMED", "CANCELLATION_REQUESTED"] as const) {
    const plan = planForwardShipmentSteps(current, "DELIVERED");
    assert.equal(plan.ok, false, `${current} should not be walkable`);
  }
});
