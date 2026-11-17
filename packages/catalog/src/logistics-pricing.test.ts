import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSlabSet } from "./logistics-pricing";

const VALID_SLABS = [
  { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30 },
  { lowerWeightGrams: 501, upperWeightGrams: 2000, price: 60 },
  { lowerWeightGrams: 2001, upperWeightGrams: 3000, price: 90 },
];

test("valid continuous slabs are accepted", () => {
  const result = validateSlabSet(3000, VALID_SLABS, 120);
  assert.equal(result.ok, true);
});

test("a gap between slabs is rejected", () => {
  const slabs = [
    { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30 },
    // gap: 501-1000 missing
    { lowerWeightGrams: 1001, upperWeightGrams: 3000, price: 90 },
  ];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /gap/i);
});

test("overlapping slabs are rejected", () => {
  const slabs = [
    { lowerWeightGrams: 0, upperWeightGrams: 600, price: 30 },
    { lowerWeightGrams: 500, upperWeightGrams: 3000, price: 90 }, // overlaps 500-600
  ];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /overlap/i);
});

test("a duplicate boundary is rejected", () => {
  const slabs = [
    { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30 },
    { lowerWeightGrams: 500, upperWeightGrams: 3000, price: 90 }, // lower duplicates prev's upper
  ];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /duplicate/i);
});

test("the first slab must start at zero", () => {
  const slabs = [
    { lowerWeightGrams: 100, upperWeightGrams: 500, price: 30 },
    { lowerWeightGrams: 501, upperWeightGrams: 3000, price: 90 },
  ];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /start at 0/i);
});

test("the last slab must reach the configured maximum", () => {
  const slabs = [
    { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30 },
    { lowerWeightGrams: 501, upperWeightGrams: 2000, price: 60 }, // stops short of 3000
  ];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /maximum covered weight/i);
});

test("a negative slab price is rejected", () => {
  const slabs = [{ lowerWeightGrams: 0, upperWeightGrams: 3000, price: -1 }];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /zero or greater/i);
});

test("a negative above-max price is rejected", () => {
  const result = validateSlabSet(3000, VALID_SLABS, -5);
  assert.equal(result.ok, false);
});

test("changing the maximum weight requires the slabs to cover the new range", () => {
  // Same slabs, but maxWeightGrams raised to 4000 without adding coverage — must fail.
  const result = validateSlabSet(4000, VALID_SLABS, 120);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /maximum covered weight/i);

  // Extending the slabs to cover the new max succeeds.
  const extended = [...VALID_SLABS, { lowerWeightGrams: 3001, upperWeightGrams: 4000, price: 110 }];
  const extendedResult = validateSlabSet(4000, extended, 120);
  assert.equal(extendedResult.ok, true);
});

test("an empty slab set is rejected", () => {
  const result = validateSlabSet(3000, [], 120);
  assert.equal(result.ok, false);
});

test("upper bound less than lower bound is rejected", () => {
  const slabs = [{ lowerWeightGrams: 0, upperWeightGrams: -1, price: 30 }];
  const result = validateSlabSet(3000, slabs, 120);
  assert.equal(result.ok, false);
});
