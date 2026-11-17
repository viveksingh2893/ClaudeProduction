import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerPromoDiscountLabel, getCustomerPromoDiscountPercent } from "@kisan4u/validators";

test("customer prepaid methods use the shared discount rules", () => {
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "ONLINE_FULL"), 5);
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "ONLINE_PARTIAL"), 2);
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "COD"), 0);
  assert.equal(getCustomerPromoDiscountPercent("DEALER", "ONLINE_FULL"), 0);
  assert.equal(getCustomerPromoDiscountLabel(5), "5% online payment discount");
});
