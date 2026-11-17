import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  collectionChargeFor,
  settlementNetPayableForSellingPrice,
  type NetPayableUnitParams,
} from "@kisan4u/validators";
import { calculateSettlement } from "./settlement-calculator";
import { calculateCollectionCharge } from "./charges";
import { applyNetPayablePricing, resolveNetPayableSellerRates } from "./net-payable-pricing";

/**
 * Drift guard: @kisan4u/validators/net-payable.ts mirrors this package's
 * settlement payable chain for the product form's live preview. If the
 * real calculator changes, this must fail so the mirror gets updated.
 */
test("net-payable forward mirror matches calculateSettlement across a grid (single line, INCLUDE tax)", () => {
  const rule = { chargeType: "PERCENTAGE" as const, value: 1.5, minCharge: 30, maxCharge: null };
  for (const gst of [0, 5, 12, 18]) {
    for (const commission of [0, 3, 8, 15]) {
      for (const logistic of [0, 70, 280, 600]) {
        for (const price of [250, 595, 1050, 5000, 18000]) {
          const params: NetPayableUnitParams = {
            commissionPercent: commission,
            commissionGstPercent: 18,
            logisticsGstPercent: 18,
            collectionChargeGstPercent: 18,
            tcsPercent: 0.5,
            tdsPercent: 0.1,
            collectionCharge: rule,
            gstRatePercent: gst,
            taxCalcMode: "INCLUDE_WITH_PRICE",
            logisticsCharge: logistic,
          };
          const mirror = settlementNetPayableForSellingPrice(price, params);
          const real = calculateSettlement({
            totalSales: price,
            gstRatePercent: gst,
            commissionValuePercent: commission,
            commissionGstRatePercent: 18,
            logistic,
            logisticGstRatePercent: 18,
            collectionCharge: collectionChargeFor(price, rule),
            collectionChargeGstRatePercent: 18,
            tcsRatePercent: 0.5,
            tdsRatePercent: 0.1,
          }).payableToSeller;
          assert.equal(
            mirror,
            real,
            `gst=${gst} comm=${commission} log=${logistic} price=${price}: mirror ${mirror} vs real ${real}`,
          );
        }
      }
    }
  }
});

test("collectionChargeFor matches the live calculateCollectionCharge for the active config", async () => {
  const config = await prisma.collectionChargeConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const rule = config
    ? {
        chargeType: config.chargeType,
        value: Number(config.value),
        minCharge: config.minCharge != null ? Number(config.minCharge) : null,
        maxCharge: config.maxCharge != null ? Number(config.maxCharge) : null,
      }
    : null;
  for (const value of [0, 500, 1200, 2000, 2001, 5000, 50000]) {
    const live = await calculateCollectionCharge(value);
    assert.equal(collectionChargeFor(value, rule), live.finalCharge, `value ${value}`);
  }
});

test("applyNetPayablePricing is a no-op for a SELLING_PRICE submission", async () => {
  const input = {
    priceEntryMode: "SELLING_PRICE" as const,
    taxPercent: 5,
    customerConfig: { mrp: 100, discountType: "FLAT" as const, discountValue: 10 },
  };
  const result = await applyNetPayablePricing(input, "any-seller-id", { strict: true });
  assert.equal(result.ok, true);
  assert.equal(input.customerConfig.discountType, "FLAT");
  assert.equal(input.customerConfig.discountValue, 10);
});

test("applyNetPayablePricing back-solves a discount for a real staging seller and keeps price <= MRP", async () => {
  // Katra — a real APPROVED seller in staging (see kisan4u memory).
  const seller = await prisma.sellerProfile.findFirst({ where: { shopName: "Katra" } });
  if (!seller) return; // staging without this seller — skip rather than fail
  const rates = await resolveNetPayableSellerRates(seller.id);
  assert.ok(rates.customer.tcsPercent === 0.5 && rates.dealer.tdsPercent === 0.1);

  const customerConfig = {
    mrp: 1200,
    weight: 400,
    netPayableAmount: 800,
    discountType: "NONE" as "NONE" | "FLAT" | "PERCENTAGE",
    discountValue: 0,
    taxCalcMode: "INCLUDE_WITH_PRICE" as const,
  };
  const input = { priceEntryMode: "NET_PAYABLE" as const, taxPercent: 5, customerConfig };
  const result = await applyNetPayablePricing(input, seller.id, { strict: true });
  assert.equal(result.ok, true);
  // A discount was derived, and the implied selling price stays at/under MRP.
  assert.equal(customerConfig.discountType, "FLAT");
  const sellingPrice = 1200 - customerConfig.discountValue;
  assert.ok(sellingPrice > 0 && sellingPrice <= 1200, `derived selling price ${sellingPrice}`);
});

test("applyNetPayablePricing (strict) rejects a net payable that would push the price over MRP", async () => {
  const seller = await prisma.sellerProfile.findFirst({ where: { shopName: "Katra" } });
  if (!seller) return;
  const input = {
    priceEntryMode: "NET_PAYABLE" as const,
    taxPercent: 5,
    customerConfig: {
      mrp: 500,
      weight: 400,
      netPayableAmount: 5000, // absurdly high vs MRP 500
      discountType: "NONE" as const,
      discountValue: 0,
      taxCalcMode: "INCLUDE_WITH_PRICE" as const,
    },
  };
  const result = await applyNetPayablePricing(input, seller.id, { strict: true });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /MRP/);
});
