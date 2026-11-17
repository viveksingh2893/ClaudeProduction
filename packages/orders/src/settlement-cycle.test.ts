import { test } from "node:test";
import assert from "node:assert/strict";
import {
  settlementCycleForEligibleDate,
  cyclePayoutDateForEligibleDate,
  settlementCycleFromKey,
  recentSettlementCycles,
} from "./settlement-cycle";

// Helper: an instant at a given IST wall-clock date/time.
function ist(year: number, month1to12: number, day: number, hour = 12): Date {
  // IST = UTC+5:30
  return new Date(Date.UTC(year, month1to12 - 1, day, hour, 0, 0) - 5.5 * 60 * 60 * 1000);
}

test("eligible 1st–7th -> paid on the 9th of the same month", () => {
  for (const day of [1, 4, 7]) {
    const c = settlementCycleForEligibleDate(ist(2026, 9, day));
    assert.equal(c.key, "2026-09-09");
    assert.equal(c.payoutLabel, "9 Sep 2026");
  }
});

test("eligible 8th–17th -> paid on the 19th", () => {
  for (const day of [8, 12, 17]) {
    assert.equal(settlementCycleForEligibleDate(ist(2026, 9, day)).key, "2026-09-19");
  }
});

test("eligible 18th–27th -> paid on the 29th", () => {
  for (const day of [18, 23, 27]) {
    assert.equal(settlementCycleForEligibleDate(ist(2026, 9, day)).key, "2026-09-29");
  }
});

test("eligible 28th–31st -> paid on the 9th of the NEXT month", () => {
  for (const day of [28, 29, 30, 31]) {
    const c = settlementCycleForEligibleDate(ist(2026, 8, day)); // August has 31 days
    assert.equal(c.key, "2026-09-09");
  }
});

test("year rollover: eligible 30 Dec -> paid 9 Jan next year", () => {
  const c = settlementCycleForEligibleDate(ist(2026, 12, 30));
  assert.equal(c.key, "2027-01-09");
});

test("February clamp: a '29th' payout falls back to the 28th in a non-leap year", () => {
  // eligible 20 Feb 2026 (2026 is not a leap year) -> 29th slot -> clamped to 28 Feb
  const c = settlementCycleForEligibleDate(ist(2026, 2, 20));
  assert.equal(c.key, "2026-02-28");
  assert.equal(c.payoutLabel, "28 Feb 2026");
});

test("February leap year keeps the 29th", () => {
  const c = settlementCycleForEligibleDate(ist(2028, 2, 20)); // 2028 is a leap year
  assert.equal(c.key, "2028-02-29");
});

test("IST boundary: 7th 23:30 IST is still the 9th slot, 8th 00:30 IST is the 19th slot", () => {
  assert.equal(settlementCycleForEligibleDate(ist(2026, 9, 7, 23)).key, "2026-09-09");
  assert.equal(settlementCycleForEligibleDate(ist(2026, 9, 8, 1)).key, "2026-09-19");
});

test("an instant just before IST midnight of the 8th (i.e. 7th late UTC) is not pushed a day forward", () => {
  // 2026-09-07 20:00 UTC == 2026-09-08 01:30 IST -> should be the 19th slot
  const utcLate7th = new Date(Date.UTC(2026, 8, 7, 20, 0, 0));
  assert.equal(settlementCycleForEligibleDate(utcLate7th).key, "2026-09-19");
});

test("payoutDate is 00:00 IST on the payout day", () => {
  const c = settlementCycleForEligibleDate(ist(2026, 9, 3));
  // 00:00 IST 9 Sep 2026 == 2026-09-08T18:30:00Z
  assert.equal(c.payoutDate.toISOString(), "2026-09-08T18:30:00.000Z");
  assert.equal(cyclePayoutDateForEligibleDate(ist(2026, 9, 3)).getTime(), c.payoutDate.getTime());
});

test("window is [start, end) and covers the right span for the 9th", () => {
  const c = settlementCycleForEligibleDate(ist(2026, 9, 3));
  assert.equal(c.windowStart.toISOString(), ist(2026, 8, 28, 0).toISOString());
  assert.equal(c.windowEnd.toISOString(), ist(2026, 9, 8, 0).toISOString());
});

test("settlementCycleFromKey round-trips every slot", () => {
  for (const key of ["2026-09-09", "2026-09-19", "2026-09-29", "2027-01-09", "2026-02-28"]) {
    const c = settlementCycleFromKey(key);
    assert.ok(c, `expected a cycle for ${key}`);
    assert.equal(c.key, key);
  }
  assert.equal(settlementCycleFromKey("not-a-date"), null);
});

test("recentSettlementCycles returns newest-first payout dates including one upcoming", () => {
  const now = ist(2026, 9, 15);
  const cycles = recentSettlementCycles(now, 6, 1);
  assert.ok(cycles.length >= 2);
  for (let i = 1; i < cycles.length; i++) {
    assert.ok(cycles[i - 1]!.payoutDate.getTime() > cycles[i]!.payoutDate.getTime());
  }
  // exactly one cycle with payoutDate in the future
  const future = cycles.filter((c) => c.payoutDate.getTime() >= now.getTime());
  assert.equal(future.length, 1);
});
