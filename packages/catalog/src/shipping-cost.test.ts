import { test } from "node:test";
import assert from "node:assert/strict";
import { matchShippingSlab } from "@kisan4u/validators";

const CONFIG = {
  maxWeightGrams: 3000,
  aboveMaxPrice: 150,
  slabs: [
    { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30 },
    { lowerWeightGrams: 501, upperWeightGrams: 2000, price: 60 },
    { lowerWeightGrams: 2001, upperWeightGrams: 3000, price: 100 },
  ],
};

test("a weight inside a slab returns that slab's price", () => {
  const result = matchShippingSlab(1000, CONFIG);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.price, 60);
});

test("a weight exactly on a slab's lower boundary returns that slab's price", () => {
  const result = matchShippingSlab(501, CONFIG);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.price, 60);
});

test("a weight exactly on a slab's upper boundary returns that slab's price, not the next slab's", () => {
  const result = matchShippingSlab(500, CONFIG);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.price, 30);
});

test("a weight exactly at the configured maximum uses the last slab's price, not the above-max price", () => {
  const result = matchShippingSlab(3000, CONFIG);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.price, 100);
});

test("a weight above the configured maximum uses the above-max standard price", () => {
  const result = matchShippingSlab(5000, CONFIG);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.price, 150);
});

test("no active logistics config returns a controlled error, never a silent zero", () => {
  const result = matchShippingSlab(1000, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not configured/i);
});

test("a weight that somehow falls into no slab (gap) fails safe instead of returning a fabricated price", () => {
  const gappyConfig = {
    maxWeightGrams: 3000,
    aboveMaxPrice: 150,
    // Deliberately missing 501-2000 coverage — validateSlabSet would reject
    // saving this, but matchShippingSlab must still fail safe if it's ever
    // called against a config that somehow has a gap.
    slabs: [
      { lowerWeightGrams: 0, upperWeightGrams: 500, price: 30 },
      { lowerWeightGrams: 2001, upperWeightGrams: 3000, price: 100 },
    ],
  };
  const result = matchShippingSlab(1000, gappyConfig);
  assert.equal(result.ok, false);
});
