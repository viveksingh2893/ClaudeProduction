import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalPercentOf, decimalToMoney, allocateProportionally } from "./money";

test("decimal-safe percentage: 1000 * 1.5% is exactly 15", () => {
  const result = decimalToMoney(decimalPercentOf(1000, 1.5));
  assert.equal(result, 15);
});

test("decimal-safe percentage avoids JS float drift on a value plain floating-point arithmetic gets wrong (0.1 + 0.2 style error)", () => {
  // 29.99 * 1.5 / 100 in plain JS float arithmetic is 0.44985000000000003,
  // not 0.44985 — decimalPercentOf must not inherit that drift.
  const plainJsDrift = (29.99 * 1.5) / 100;
  assert.notEqual(plainJsDrift, 0.44985);
  const result = decimalPercentOf(29.99, 1.5).toNumber();
  assert.equal(result, 0.44985);
});

test("collection-charge-style boundary: 2000 * 1.5% is exactly 30, matching the flat minimum at the crossover point", () => {
  assert.equal(decimalToMoney(decimalPercentOf(2000, 1.5)), 30);
});

test("allocateProportionally splits a total exactly across weighted shares with no leftover paisa", () => {
  const shares = allocateProportionally(50, [333.33, 333.33, 333.34]);
  const sum = Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.equal(sum, 50);
  assert.equal(shares.length, 3);
});

test("allocateProportionally: zero total allocates zero to every share", () => {
  const shares = allocateProportionally(0, [100, 200, 300]);
  assert.deepEqual(shares, [0, 0, 0]);
});

test("allocateProportionally: single weight gets the whole total", () => {
  const shares = allocateProportionally(45.5, [1000]);
  assert.deepEqual(shares, [45.5]);
});
