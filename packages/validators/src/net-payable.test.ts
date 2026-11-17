/** Pure function tests, no DB — the net-payable pricing-aid inverse/forward. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectionChargeFor,
  settlementNetPayableForSellingPrice,
  deriveSellingPriceFromNetPayable,
  maxNetPayableForMrp,
  type NetPayableUnitParams,
} from "./net-payable";

// Mirrors the staging platform-default settlement config: 18% GST on every
// settlement component, fixed 0.5% TCS / 0.1% TDS, collection charge = higher
// of ₹30 or 1.5%, and the 0–500 g logistics slab at ₹70.
function params(overrides: Partial<NetPayableUnitParams> = {}): NetPayableUnitParams {
  return {
    commissionPercent: 8,
    commissionGstPercent: 18,
    logisticsGstPercent: 18,
    collectionChargeGstPercent: 18,
    tcsPercent: 0.5,
    tdsPercent: 0.1,
    collectionCharge: { chargeType: "PERCENTAGE", value: 1.5, minCharge: 30, maxCharge: null },
    gstRatePercent: 5,
    taxCalcMode: "INCLUDE_WITH_PRICE",
    logisticsCharge: 70,
    ...overrides,
  };
}

test("forward: the hand-worked ₹1,050 / 5% GST / 8% commission example nets ₹826.83", () => {
  assert.equal(settlementNetPayableForSellingPrice(1050, params()), 826.83);
});

test("inverse recovers that selling price exactly from ₹826.83", () => {
  const result = deriveSellingPriceFromNetPayable(826.83, params());
  assert.equal(result.sellingPrice, 1050);
  assert.equal(result.exact, true);
  assert.equal(result.netPayable, 826.83);
});

test("collection charge: floor regime (1.5% below ₹30 → flat ₹30)", () => {
  assert.equal(collectionChargeFor(1050, params().collectionCharge), 30);
});

test("collection charge: proportional regime (1.5% above ₹30)", () => {
  assert.equal(collectionChargeFor(5000, params().collectionCharge), 75);
});

test("inverse round-trips through the proportional collection-charge regime", () => {
  const p = params({ gstRatePercent: 0, commissionPercent: 5 });
  const net = settlementNetPayableForSellingPrice(5000, p);
  const back = deriveSellingPriceFromNetPayable(net, p);
  assert.equal(back.sellingPrice, 5000);
  assert.equal(back.exact, true);
});

test("EXCLUDE_WITH_PRICE: net payable is computed on price×(1+GST), inverse returns the pre-tax price", () => {
  const p = params({ taxCalcMode: "EXCLUDE_WITH_PRICE" });
  // sellingPrice 1000 excl. 5% GST → same ₹1,050 total sales as the inclusive example
  assert.equal(settlementNetPayableForSellingPrice(1000, p), 826.83);
  assert.equal(deriveSellingPriceFromNetPayable(826.83, p).sellingPrice, 1000);
});

test("zero commission (a real Katra/Royal seller) still inverts cleanly", () => {
  const p = params({ commissionPercent: 0, gstRatePercent: 0 });
  const net = settlementNetPayableForSellingPrice(2000, p);
  const back = deriveSellingPriceFromNetPayable(net, p);
  assert.equal(back.sellingPrice, 2000);
  assert.equal(back.exact, true);
});

test("no active collection-charge config → collection charge is ₹0 and inverse still works", () => {
  const p = params({ collectionCharge: null });
  const net = settlementNetPayableForSellingPrice(1200, p);
  const back = deriveSellingPriceFromNetPayable(net, p);
  assert.equal(back.sellingPrice, 1200);
});

test("FLAT collection charge respects its min/max clamp and is treated as constant", () => {
  const rule = { chargeType: "FLAT" as const, value: 50, minCharge: 40, maxCharge: 45 };
  assert.equal(collectionChargeFor(999, rule), 45); // clamped down to max
  const p = params({ collectionCharge: rule });
  const net = settlementNetPayableForSellingPrice(900, p);
  assert.equal(deriveSellingPriceFromNetPayable(net, p).sellingPrice, 900);
});

test("maxNetPayableForMrp equals the forward net payable at a selling price of MRP", () => {
  const p = params();
  assert.equal(maxNetPayableForMrp(1100, p), settlementNetPayableForSellingPrice(1100, p));
});

test("a target above maxNetPayableForMrp derives a selling price above MRP (caller rejects it)", () => {
  const p = params();
  const mrp = 1100;
  const ceiling = maxNetPayableForMrp(mrp, p);
  const over = deriveSellingPriceFromNetPayable(round2(ceiling + 20), p);
  assert.ok(over.sellingPrice > mrp);
});

test("a target below what even a ₹0 price could net (fixed charges dominate) yields sellingPrice 0", () => {
  // At tiny prices the seller still bears logistics + collection charge +
  // their taxes (~₹118 here), so any net payable below roughly -₹118 has no
  // positive-price solution at all.
  const result = deriveSellingPriceFromNetPayable(-300, params());
  assert.equal(result.sellingPrice, 0);
  assert.equal(result.exact, false);
});

test("derive → forward round-trips within a few paise across a price sweep", () => {
  const p = params();
  for (let price = 200; price <= 20000; price += 137) {
    const net = settlementNetPayableForSellingPrice(price, p);
    const back = deriveSellingPriceFromNetPayable(net, p);
    // Not exact-equal: the forward chain is many-to-one at 2dp, so several
    // adjacent prices map to the same net payable — the inverse lands in
    // that equivalence class, which is all a pricing aid needs.
    assert.ok(
      Math.abs(back.sellingPrice - price) <= 0.05,
      `price ${price}: net ${net} → back ${back.sellingPrice}`,
    );
    assert.ok(Math.abs(settlementNetPayableForSellingPrice(back.sellingPrice, p) - net) <= 0.01);
  }
});

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
