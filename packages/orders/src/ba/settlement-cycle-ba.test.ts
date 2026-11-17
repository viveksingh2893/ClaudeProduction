import { test } from "node:test";
import assert from "node:assert/strict";
import {
  payoutMonthKey,
  baPayoutCycleFromKey,
  baPayoutCycleForDate,
  recentBaPayoutCycles,
} from "./settlement-cycle-ba";

// 2026-09-15 12:00 IST == 2026-09-15 06:30 UTC
const midSep = new Date("2026-09-15T06:30:00.000Z");

test("payoutMonthKey is the IST calendar month", () => {
  assert.equal(payoutMonthKey(midSep), "2026-09");
  // 2026-10-01 02:00 IST is still September 30 in UTC but October in IST
  assert.equal(payoutMonthKey(new Date("2026-09-30T20:30:00.000Z")), "2026-10");
});

test("a month cycle pays out at 00:00 IST on the 1st of the next month", () => {
  const c = baPayoutCycleForDate(midSep);
  assert.equal(c.key, "2026-09");
  assert.equal(c.label, "September 2026");
  assert.equal(c.lastDayLabel, "30 Sep 2026");
  // 00:00 IST on 1 Oct 2026 == 2026-09-30T18:30:00Z
  assert.equal(c.payoutDate.toISOString(), "2026-09-30T18:30:00.000Z");
});

test("February clamps its last day correctly", () => {
  const c = baPayoutCycleFromKey("2027-02");
  assert.equal(c?.lastDayLabel, "28 Feb 2027");
});

test("baPayoutCycleFromKey rejects a malformed key", () => {
  assert.equal(baPayoutCycleFromKey("2026-13"), null);
  assert.equal(baPayoutCycleFromKey("nope"), null);
});

test("recentBaPayoutCycles returns N distinct months, newest first", () => {
  const cycles = recentBaPayoutCycles(midSep, 6);
  assert.equal(cycles.length, 6);
  assert.equal(cycles[0]!.key, "2026-09");
  assert.equal(cycles[5]!.key, "2026-04");
  const keys = new Set(cycles.map((c) => c.key));
  assert.equal(keys.size, 6);
});
