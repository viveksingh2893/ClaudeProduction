import { test } from "node:test";
import assert from "node:assert/strict";
import { refundChoicesFor } from "./refunds";

// Pure — no database. The refund dropdown on the admin orders tables.

const methods = (ctx: Parameters<typeof refundChoicesFor>[0]) =>
  refundChoicesFor(ctx).map((c) => c.method);

test("POS order: manual or wallet", () => {
  const choices = refundChoicesFor({
    isPos: true,
    buyerChoice: null,
    paymentMethod: "ONLINE_FULL",
    hasGatewayPayment: false,
  });
  assert.deepEqual(
    choices.map((c) => [c.method, c.label, c.needsReference]),
    [
      ["ORIGINAL_SOURCE", "Refund manually", true],
      ["WALLET", "Refund to wallet", false],
    ],
  );
});

test("POS COD order: manual is recorded as a bank transfer (COD has no original source)", () => {
  assert.deepEqual(
    methods({ isPos: true, buyerChoice: null, paymentMethod: "COD", hasGatewayPayment: false }),
    ["BANK_TRANSFER", "WALLET"],
  );
});

test("the buyer's own choice is the only option", () => {
  assert.deepEqual(
    methods({ isPos: false, buyerChoice: "ORIGINAL_SOURCE", paymentMethod: "ONLINE_FULL", hasGatewayPayment: true }),
    ["ORIGINAL_SOURCE"],
  );
  assert.deepEqual(
    methods({ isPos: false, buyerChoice: "WALLET", paymentMethod: "ONLINE_FULL", hasGatewayPayment: true }),
    ["WALLET"],
  );
});

test("nobody chose (admin cancel / RTO) on a Razorpay order: wallet or Razorpay", () => {
  const choices = refundChoicesFor({
    isPos: false,
    buyerChoice: null,
    paymentMethod: "ONLINE_PARTIAL",
    hasGatewayPayment: true,
  });
  assert.deepEqual(
    choices.map((c) => [c.method, c.label, c.needsReference]),
    [
      ["WALLET", "Refund to wallet", false],
      ["ORIGINAL_SOURCE", "Razorpay refund", false],
    ],
  );
});

test("nobody chose and there's no Razorpay payment: wallet only (auto-completes)", () => {
  assert.deepEqual(
    methods({ isPos: false, buyerChoice: null, paymentMethod: "WALLET", hasGatewayPayment: false }),
    ["WALLET"],
  );
});
