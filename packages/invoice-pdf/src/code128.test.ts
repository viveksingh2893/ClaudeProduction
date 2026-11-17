import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE128_PATTERNS,
  CODE128_STOP,
  code128Checksum,
  code128ModuleCount,
  code128Values,
  encodeCode128,
} from "./code128";

test("every Code 128 symbol is six alternating elements totalling 11 modules, and no two are alike", () => {
  assert.equal(CODE128_PATTERNS.length, 106);
  for (const pattern of CODE128_PATTERNS) {
    assert.equal(pattern.length, 6);
    assert.equal(
      [...pattern].reduce((total, ch) => total + Number(ch), 0),
      11,
      `pattern ${pattern} must be 11 modules wide`,
    );
  }
  assert.equal(new Set(CODE128_PATTERNS).size, CODE128_PATTERNS.length);
  // Stop is the only 7-element symbol: 13 modules.
  assert.equal([...CODE128_STOP].reduce((total, ch) => total + Number(ch), 0), 13);
});

test("checksum matches the worked Code 128 example (PJJ123C in subset A → 54)", () => {
  // Start A = 103, then P J J 1 2 3 C as subset-A symbol values.
  assert.equal(code128Checksum([103, 48, 42, 42, 17, 18, 19, 35]), 54);
});

test("an even-length all-digit AWB uses subset C (digit pairs), anything else subset B", () => {
  assert.deepEqual(code128Values("20853910212332"), [105, 20, 85, 39, 10, 21, 23, 32]);
  assert.deepEqual(code128Values("AB1"), [104, 33, 34, 17]);
  // Odd digit count can't be paired.
  assert.equal(code128Values("123")[0], 104);
});

test("encoded barcode width is (symbols + checksum) * 11 + 13 modules", () => {
  const values = code128Values("20853910212332");
  const widths = encodeCode128("20853910212332");
  assert.equal(code128ModuleCount(widths), (values.length + 1) * 11 + 13);
  // 6 elements per symbol + 7 for stop.
  assert.equal(widths.length, (values.length + 1) * 6 + 7);
});

test("rejects empty and non-ASCII input", () => {
  assert.throws(() => encodeCode128(""));
  assert.throws(() => encodeCode128("AWBé"));
});
