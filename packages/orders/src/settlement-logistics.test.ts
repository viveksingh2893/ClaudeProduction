/**
 * Pure unit tests for the per-item logistics slab math the settlement
 * correction requires — no database dependency, so these run alongside
 * settlement-calculator.test.ts without contending with whatever
 * LogisticsPricingConfig happens to be active in the dev database (that
 * live-config wiring is exercised end-to-end by the DB-backed
 * calculateItemLogisticsCharge/upsertSettlementsForSellerOrder integration
 * tests in settlement.test.ts instead). matchShippingSlab
 * (@kisan4u/validators) is the exact same pure matcher
 * calculateItemLogisticsCharge (settlement-logistics.ts) calls after
 * loading the active config from the database — testing it directly here
 * with a hand-built config is equivalent to testing the real code path's
 * slab-selection logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchShippingSlab, type ShippingConfigInput } from "@kisan4u/validators";
import { calculateSettlement } from "./settlement-calculator";
import { round2 } from "./money";

const TASK_EXAMPLE_CONFIG: ShippingConfigInput = {
  maxWeightGrams: 3000,
  aboveMaxPrice: 150,
  slabs: [
    { lowerWeightGrams: 0, upperWeightGrams: 499, price: 60 },
    { lowerWeightGrams: 500, upperWeightGrams: 2000, price: 100 },
    { lowerWeightGrams: 2001, upperWeightGrams: 3000, price: 150 },
  ],
};

test("300g unit weight, quantity 2: matches the 0-499g slab at Rs 60/unit -> Rs 120 base logistics, Rs 21.60 logistics tax", () => {
  const match = matchShippingSlab(300, TASK_EXAMPLE_CONFIG);
  assert.equal(match.ok, true);
  if (!match.ok) return;
  assert.equal(match.price, 60);

  const baseLogisticsCharge = round2(match.price * 2);
  assert.equal(baseLogisticsCharge, 120);

  // Confirms the per-item base charge feeds into the SAME centralized
  // logisticTax formula every other settlement input uses — no separate
  // tax formula invented for logistics.
  const result = calculateSettlement({
    totalSales: 1000,
    gstRatePercent: 18,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: baseLogisticsCharge,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  assert.equal(result.logisticTax, 21.6);
});

test("slab boundary at 499g: the lower slab's own upper bound still matches (never falls through to the next slab)", () => {
  const match = matchShippingSlab(499, TASK_EXAMPLE_CONFIG);
  assert.equal(match.ok, true);
  if (match.ok) assert.equal(match.price, 60);
});

test("slab boundary at 500g: the next slab up matches exactly at its own lower bound (never double-matches the previous slab)", () => {
  const match = matchShippingSlab(500, TASK_EXAMPLE_CONFIG);
  assert.equal(match.ok, true);
  if (match.ok) assert.equal(match.price, 100);
});

test("0g unit weight matches the first slab (0-499g), never a silent Rs 0", () => {
  const match = matchShippingSlab(0, TASK_EXAMPLE_CONFIG);
  assert.equal(match.ok, true);
  if (match.ok) assert.equal(match.price, 60);
});

test("no matching slab (e.g. a null/absent config) fails with a clear error, never a silent Rs 0", () => {
  const match = matchShippingSlab(300, null);
  assert.equal(match.ok, false);
  if (!match.ok) assert.match(match.error, /not configured/i);
});

test("above the maximum covered weight uses the configured above-max price", () => {
  const match = matchShippingSlab(3500, TASK_EXAMPLE_CONFIG);
  assert.equal(match.ok, true);
  if (match.ok) assert.equal(match.price, 150);
});
