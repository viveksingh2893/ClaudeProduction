import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateSettlement } from "./settlement-calculator";

// --- Golden yellow row from the corrected settlement workbook
// (demo-agri-shop_settlements_all-time_corrected.xlsx, `Settlements` sheet,
// row 8) — the verified source of truth for the settlement-correction task.
// Verified by hand against the workbook's own formulas (L8=J8/(1+P8/100)*K8,
// O8=J8*K8, Q8=L8*P8%, T8=O8*S8%, U8=T8*18%, W8=V8*18%, Y8=X8*18%,
// Z8=L8*0.5%, AA8=O8*0.1%, AD8=O8-T8-U8-V8-W8-X8-Y8-Z8-AA8).

test("golden yellow row: Rs 595 x2 @ 18% GST, 20% commission, Rs 70 logistics, Rs 30 collection charge -> Rs 784.93 payable", () => {
  const result = calculateSettlement({
    totalSales: 1190, // 595 * 2 (unitPriceIncTax * fulfilledQty)
    gstRatePercent: 18,
    commissionValuePercent: 20,
    commissionGstRatePercent: 18,
    logistic: 70,
    logisticGstRatePercent: 18,
    collectionCharge: 30,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });

  assert.equal(result.netSalesExclTax, 1008.47);
  assert.equal(result.gstTax, 181.53);
  assert.equal(result.grossCommission, 238);
  assert.equal(result.grossCommissionTax, 42.84);
  assert.equal(result.logisticTax, 12.6);
  assert.equal(result.collectionChargeTax, 5.4);
  assert.equal(result.tcs, 5.04);
  assert.equal(result.tds, 1.19);
  assert.equal(result.payableToSeller, 784.93);
});

test("0% GST product: taxable value equals total sales, product GST and TCS are both zero, payable is unaffected by GST", () => {
  const result = calculateSettlement({
    totalSales: 999, // matches the corrected workbook's row-5 example (Customer Bio Fertiliser, GST rate 0)
    gstRatePercent: 0,
    commissionValuePercent: 20,
    commissionGstRatePercent: 18,
    logistic: 43.08,
    logisticGstRatePercent: 18,
    collectionCharge: 8.62,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });

  assert.equal(result.netSalesExclTax, 999);
  assert.equal(result.gstTax, 0);
  assert.equal(result.tcs, round2(999 * 0.005));
  assert.equal(
    result.payableToSeller,
    round2(
      999 -
        result.grossCommission -
        result.grossCommissionTax -
        43.08 -
        result.logisticTax -
        8.62 -
        result.collectionChargeTax -
        result.tcs -
        result.tds,
    ),
  );
});

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// --- Golden examples reproduced exactly from the attached
// Order_Transaction_details.xlsx (rows 2 and 4) — these MUST fail if
// rounding or the deduction order ever changes the expected result.

test("golden example 1: Rs 4670 total sales, 18% GST, 15% commission, no logistics", () => {
  const result = calculateSettlement({
    totalSales: 4670,
    gstRatePercent: 18,
    commissionValuePercent: 15,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 70.05,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });

  assert.equal(result.netSalesExclTax, 3957.63);
  assert.equal(result.gstTax, 712.37);
  assert.equal(result.grossCommission, 700.5);
  assert.equal(result.grossCommissionTax, 126.09);
  assert.equal(result.logisticTax, 0);
  assert.equal(result.collectionChargeTax, 12.61);
  assert.equal(result.tcs, 19.79);
  assert.equal(result.tds, 4.67);
  assert.equal(result.payableToSeller, 3736.29);
});

test("golden example 2: Rs 826 total sales, 18% GST, 15% commission, with logistics", () => {
  const result = calculateSettlement({
    totalSales: 826,
    gstRatePercent: 18,
    commissionValuePercent: 15,
    commissionGstRatePercent: 18,
    logistic: 170,
    logisticGstRatePercent: 18,
    collectionCharge: 30,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });

  assert.equal(result.netSalesExclTax, 700);
  assert.equal(result.gstTax, 126);
  assert.equal(result.grossCommission, 123.9);
  assert.equal(result.grossCommissionTax, 22.3);
  assert.equal(result.logisticTax, 30.6);
  assert.equal(result.collectionChargeTax, 5.4);
  assert.equal(result.tcs, 3.5);
  assert.equal(result.tds, 0.83);
  assert.equal(result.payableToSeller, 439.47);
});

function round2sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

test("reconciliation identity holds for golden example 1 (logistic=0, collectionCharge=70.05)", () => {
  const logistic = 0;
  const collectionCharge = 70.05;
  const result = calculateSettlement({
    totalSales: 4670,
    gstRatePercent: 18,
    commissionValuePercent: 15,
    commissionGstRatePercent: 18,
    logistic,
    logisticGstRatePercent: 18,
    collectionCharge,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  const total =
    result.payableToSeller +
    result.grossCommission +
    result.grossCommissionTax +
    logistic +
    result.logisticTax +
    collectionCharge +
    result.collectionChargeTax +
    result.tcs +
    result.tds;
  assert.equal(round2sum([total]), 4670);
});

test("reconciliation identity holds for golden example 2 (logistic=170, collectionCharge=30)", () => {
  const logistic = 170;
  const collectionCharge = 30;
  const result = calculateSettlement({
    totalSales: 826,
    gstRatePercent: 18,
    commissionValuePercent: 15,
    commissionGstRatePercent: 18,
    logistic,
    logisticGstRatePercent: 18,
    collectionCharge,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  const total =
    result.payableToSeller +
    result.grossCommission +
    result.grossCommissionTax +
    logistic +
    result.logisticTax +
    collectionCharge +
    result.collectionChargeTax +
    result.tcs +
    result.tds;
  assert.equal(round2sum([total]), 826);
});

test("zero GST: net sales excl tax equals total sales, GST tax is zero", () => {
  const result = calculateSettlement({
    totalSales: 1000,
    gstRatePercent: 0,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  assert.equal(result.netSalesExclTax, 1000);
  assert.equal(result.gstTax, 0);
});

test("zero commission: gross commission and its tax are both zero, payable is total sales minus only TCS/TDS", () => {
  const result = calculateSettlement({
    totalSales: 1000,
    gstRatePercent: 18,
    commissionValuePercent: 0,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  assert.equal(result.grossCommission, 0);
  assert.equal(result.grossCommissionTax, 0);
  const netSalesExclTax = round2sum([1000 / 1.18]);
  const expectedTcs = round2sum([netSalesExclTax * 0.005]);
  const expectedTds = round2sum([1000 * 0.001]);
  assert.equal(result.payableToSeller, round2sum([1000 - expectedTcs - expectedTds]));
});

test("zero logistics and collection charges contribute nothing to deductions", () => {
  const result = calculateSettlement({
    totalSales: 500,
    gstRatePercent: 18,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0,
    tdsRatePercent: 0,
  });
  assert.equal(result.logisticTax, 0);
  assert.equal(result.collectionChargeTax, 0);
});

test("quantity greater than one is reflected purely through a larger totalSales input (caller multiplies unit price x qty before calling)", () => {
  const perUnit = calculateSettlement({
    totalSales: 236,
    gstRatePercent: 18,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0,
    tdsRatePercent: 0,
  });
  const forQtyFour = calculateSettlement({
    totalSales: 236 * 4,
    gstRatePercent: 18,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0,
    tdsRatePercent: 0,
  });
  assert.equal(round2sum([perUnit.netSalesExclTax * 4]), forQtyFour.netSalesExclTax);
  assert.equal(round2sum([perUnit.grossCommission * 4]), forQtyFour.grossCommission);
});

test("fractional prices round each component to 2dp independently (paise-level precision)", () => {
  const result = calculateSettlement({
    totalSales: 333.33,
    gstRatePercent: 18,
    commissionValuePercent: 12.5,
    commissionGstRatePercent: 18,
    logistic: 19.99,
    logisticGstRatePercent: 18,
    collectionCharge: 11.11,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  // Every field must already be rounded to exactly 2dp.
  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== "number") continue;
    assert.equal(Math.round(value * 100), value * 100, `${key} (${value}) must be rounded to 2dp`);
  }
});

test("negative payable is never clamped to zero", () => {
  const result = calculateSettlement({
    totalSales: 100,
    gstRatePercent: 18,
    commissionValuePercent: 50,
    commissionGstRatePercent: 18,
    logistic: 40,
    logisticGstRatePercent: 18,
    collectionCharge: 30,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0.5,
    tdsRatePercent: 0.1,
  });
  assert.ok(
    result.payableToSeller < 0,
    `expected a negative payable, got ${result.payableToSeller}`,
  );
  assert.equal(result.isNegativePayable, true);
});

test("approved settlement adjustments shift the final payable by exactly their signed amount", () => {
  const withoutAdjustment = calculateSettlement({
    totalSales: 1000,
    gstRatePercent: 18,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0,
    tdsRatePercent: 0,
  });
  const withAdjustment = calculateSettlement({
    totalSales: 1000,
    gstRatePercent: 18,
    commissionValuePercent: 10,
    commissionGstRatePercent: 18,
    logistic: 0,
    logisticGstRatePercent: 18,
    collectionCharge: 0,
    collectionChargeGstRatePercent: 18,
    tcsRatePercent: 0,
    tdsRatePercent: 0,
    adjustments: -50,
  });
  assert.equal(round2sum([withoutAdjustment.payableToSeller - 50]), withAdjustment.payableToSeller);
});
