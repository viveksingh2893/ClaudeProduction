import assert from "node:assert/strict";
import test from "node:test";
import { clampQuantity } from "./quantity";

test("quantity clamps to MOQ and stock", () => {
  assert.equal(clampQuantity(1, 10, 50), 10);
  assert.equal(clampQuantity(30, 10, 50), 30);
  assert.equal(clampQuantity(99, 10, 50), 50);
});

test("quantity normalizes invalid values", () => {
  assert.equal(clampQuantity(Number.NaN, 2), 2);
  assert.equal(clampQuantity(4.9, 1), 4);
});
