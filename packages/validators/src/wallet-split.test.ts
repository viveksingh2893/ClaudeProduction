/** Pure function tests, no DB — the wallet-applied-last split for COD / partial / prepaid. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWalletSplit } from "./partial-payment";

test("COD: wallet comes off the whole total, the rest is due on delivery", () => {
  const r = computeWalletSplit({ kind: "COD", grandTotal: 1000, walletBalance: 500, walletRequested: 300 });
  assert.deepEqual(r, { walletEligibleCap: 500, walletApplied: 300, onlineNow: 0, codDue: 700 });
});

test("prepaid: wallet comes off the whole total, the rest is paid online", () => {
  const r = computeWalletSplit({ kind: "PREPAID", grandTotal: 1000, walletBalance: 500, walletRequested: 300 });
  assert.deepEqual(r, { walletEligibleCap: 500, walletApplied: 300, onlineNow: 700, codDue: 0 });
});

test("prepaid: a wallet that covers everything leaves nothing to pay online", () => {
  const r = computeWalletSplit({ kind: "PREPAID", grandTotal: 1000, walletBalance: 5000, walletRequested: 5000 });
  assert.equal(r.walletApplied, 1000);
  assert.equal(r.onlineNow, 0);
});

test("partial: 1000 total, 200 advance, wallet comes off the 800 COD remainder only", () => {
  const r = computeWalletSplit({
    kind: "PARTIAL",
    grandTotal: 1000,
    advanceAmount: 200,
    walletBalance: 300,
    walletRequested: 300,
  });
  assert.deepEqual(r, { walletEligibleCap: 300, walletApplied: 300, onlineNow: 200, codDue: 500 });
});

test("partial: a big wallet is capped at the COD remainder and never touches the advance", () => {
  const r = computeWalletSplit({
    kind: "PARTIAL",
    grandTotal: 1000,
    advanceAmount: 200,
    walletBalance: 5000,
    walletRequested: 5000,
  });
  assert.deepEqual(r, { walletEligibleCap: 800, walletApplied: 800, onlineNow: 200, codDue: 0 });
});

test("requested amount is clamped to the cap and never negative", () => {
  const over = computeWalletSplit({ kind: "COD", grandTotal: 1000, walletBalance: 100, walletRequested: 900 });
  assert.equal(over.walletApplied, 100);
  const neg = computeWalletSplit({ kind: "COD", grandTotal: 1000, walletBalance: 100, walletRequested: -50 });
  assert.equal(neg.walletApplied, 0);
  assert.equal(neg.codDue, 1000);
});

test("rounds to paise", () => {
  const r = computeWalletSplit({
    kind: "PARTIAL",
    grandTotal: 999.99,
    advanceAmount: 333.33,
    walletBalance: 10.005,
    walletRequested: 10.005,
  });
  assert.equal(r.onlineNow, 333.33);
  assert.equal(Math.round((r.walletApplied + r.codDue) * 100) / 100, 666.66);
});
