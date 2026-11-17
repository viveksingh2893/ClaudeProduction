import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateBaCommissionForSellerOrder,
  BA_COMMISSION_GST_PERCENT,
} from "./commission";

test("spec worked example — seller A: ₹300 base at 2% → ₹6, split ₹2 / ₹4 by line value", () => {
  const res = calculateBaCommissionForSellerOrder(300, 2, [
    { lineId: "a1", lineValue: 100 },
    { lineId: "a2", lineValue: 200 },
  ]);
  assert.equal(res.sellerOrderBaCommission, 6);
  assert.equal(res.gstRatePercent, BA_COMMISSION_GST_PERCENT);
  assert.equal(res.sellerOrderBaCommissionGst, 1.08); // 18% of 6
  assert.deepEqual(
    res.lines.map((l) => l.baCommission),
    [2, 4],
  );
  // Line GST shares also sum back to the seller-order GST total, paise-exact.
  const gstSum =
    Math.round(res.lines.reduce((s, l) => s + l.baCommissionGst, 0) * 100) / 100;
  assert.equal(gstSum, res.sellerOrderBaCommissionGst);
});

test("spec worked example — seller B: ₹300 base at 2% → ₹6 on a single line", () => {
  const res = calculateBaCommissionForSellerOrder(300, 2, [{ lineId: "b1", lineValue: 300 }]);
  assert.equal(res.sellerOrderBaCommission, 6);
  assert.deepEqual(res.lines.map((l) => l.baCommission), [6]);
});

test("different per-seller rates: same ₹300 base at 3% → ₹9", () => {
  const res = calculateBaCommissionForSellerOrder(300, 3, [
    { lineId: "x", lineValue: 150 },
    { lineId: "y", lineValue: 150 },
  ]);
  assert.equal(res.sellerOrderBaCommission, 9);
  assert.deepEqual(res.lines.map((l) => l.baCommission), [4.5, 4.5]);
});

test("zero / negative / non-finite inputs never produce a commission", () => {
  assert.equal(calculateBaCommissionForSellerOrder(0, 2, [{ lineId: "a", lineValue: 10 }]).sellerOrderBaCommission, 0);
  assert.equal(calculateBaCommissionForSellerOrder(-100, 2, [{ lineId: "a", lineValue: 10 }]).sellerOrderBaCommission, 0);
  assert.equal(calculateBaCommissionForSellerOrder(100, 0, [{ lineId: "a", lineValue: 10 }]).sellerOrderBaCommission, 0);
  assert.equal(calculateBaCommissionForSellerOrder(NaN, 2, [{ lineId: "a", lineValue: 10 }]).sellerOrderBaCommission, 0);
});

test("allocation is paise-exact — line shares always sum back to the seller-order commission", () => {
  const res = calculateBaCommissionForSellerOrder(999.99, 2.5, [
    { lineId: "a", lineValue: 333.33 },
    { lineId: "b", lineValue: 333.33 },
    { lineId: "c", lineValue: 333.33 },
  ]);
  const sum = Math.round(res.lines.reduce((s, l) => s + l.baCommission, 0) * 100) / 100;
  assert.equal(sum, res.sellerOrderBaCommission);
});

test("a zero-value line gets no share; the rest still sum to the total", () => {
  const res = calculateBaCommissionForSellerOrder(200, 2, [
    { lineId: "paid", lineValue: 200 },
    { lineId: "free", lineValue: 0 },
  ]);
  assert.equal(res.sellerOrderBaCommission, 4);
  assert.deepEqual(res.lines.map((l) => l.baCommission), [4, 0]);
});
