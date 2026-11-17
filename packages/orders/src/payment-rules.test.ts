import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePaymentMethodRules } from "./payment-rules";

test("customer may use COD, ONLINE_FULL, or ONLINE_PARTIAL", () => {
  for (const method of ["COD", "ONLINE_FULL", "ONLINE_PARTIAL"] as const) {
    assert.equal(
      validatePaymentMethodRules("CUSTOMER", "KISAN4U_COURIER", method).ok,
      true,
      method,
    );
  }
});

// WALLET is never a selectable payment method for either customer type —
// it's applied as an additive amount on top of whichever method above IS
// selected (checkoutInputSchema's walletAmountApplied), not chosen from
// this list. See packages/orders/src/wallet.ts.
test("WALLET is never an allowed payment method on its own, for either customer type", () => {
  assert.equal(validatePaymentMethodRules("CUSTOMER", "KISAN4U_COURIER", "WALLET").ok, false);
  assert.equal(validatePaymentMethodRules("DEALER", "KISAN4U_COURIER", "WALLET").ok, false);
  assert.equal(validatePaymentMethodRules("DEALER", "TRANSPORT", "WALLET").ok, false);
});

test("customer cannot use TRANSPORT_FULL_ONLINE — that method is dealer-Transport-only", () => {
  const result = validatePaymentMethodRules("CUSTOMER", "KISAN4U_COURIER", "TRANSPORT_FULL_ONLINE");
  assert.equal(result.ok, false);
});

test("dealer Kisan4U Courier allows only ONLINE_FULL or ONLINE_PARTIAL — COD is blocked", () => {
  assert.equal(validatePaymentMethodRules("DEALER", "KISAN4U_COURIER", "ONLINE_FULL").ok, true);
  assert.equal(validatePaymentMethodRules("DEALER", "KISAN4U_COURIER", "ONLINE_PARTIAL").ok, true);
  assert.equal(validatePaymentMethodRules("DEALER", "KISAN4U_COURIER", "COD").ok, false);
  assert.equal(validatePaymentMethodRules("DEALER", "KISAN4U_COURIER", "WALLET").ok, false);
});

test("dealer Transport requires full online payment only — COD and partial are both rejected", () => {
  assert.equal(validatePaymentMethodRules("DEALER", "TRANSPORT", "TRANSPORT_FULL_ONLINE").ok, true);
  assert.equal(validatePaymentMethodRules("DEALER", "TRANSPORT", "ONLINE_PARTIAL").ok, false);
  assert.equal(validatePaymentMethodRules("DEALER", "TRANSPORT", "COD").ok, false);
  assert.equal(validatePaymentMethodRules("DEALER", "TRANSPORT", "ONLINE_FULL").ok, false);
});
