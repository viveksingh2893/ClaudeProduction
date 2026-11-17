/**
 * Settlement payout cycles.
 *
 * Kisan4U pays sellers three times a month — on the 9th, 19th and 29th.
 * A settlement is assigned to a cycle by the date it becomes *eligible*
 * (delivery + the 48h return-window hold — see SettlementSettings.holdDays
 * and settlement.ts:upsertSettlementsForSellerOrder), NOT by the raw
 * delivery date. Windows (all boundaries in IST — India has no DST, so
 * IST is a fixed UTC+5:30):
 *
 *   eligible 28th (prev month) – 7th   ->  paid on the  9th
 *   eligible 8th  – 17th               ->  paid on the 19th
 *   eligible 18th – 27th               ->  paid on the 29th
 *
 * When a month has no 29th (February), the "29th" payout clamps to the
 * last day of that month.
 *
 * The payout date is stored (frozen) on each SellerSettlement row as
 * `cyclePayoutDate` — the instant of 00:00 IST on the payout day — so the
 * admin settlement page can group and filter by an exact equality match
 * and a later rule change never silently re-buckets historical rows.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const SETTLEMENT_PAYOUT_DAYS = [9, 19, 29] as const;

export type SettlementCycle = {
  /** Stable id for URLs / <option> values — the payout day as YYYY-MM-DD in IST. */
  key: string;
  /** 00:00 IST on the payout day, as a real instant (what SellerSettlement.cyclePayoutDate stores). */
  payoutDate: Date;
  /** First instant (inclusive) of the eligibility window feeding this payout. */
  windowStart: Date;
  /** First instant (exclusive) after the eligibility window. */
  windowEnd: Date;
  /** e.g. "9 Sep 2026" */
  payoutLabel: string;
  /** e.g. "28 Aug – 7 Sep 2026" */
  windowLabel: string;
};

/** IST wall-clock parts for an instant. */
function istParts(d: Date): { year: number; month: number; day: number } {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-11
    day: shifted.getUTCDate(),
  };
}

/** The real instant of 00:00 IST on a given IST calendar day (month is 0-11). */
function istMidnightInstant(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmt(year: number, month: number, day: number): string {
  return `${day} ${MONTHS[month]} ${year}`;
}

function isoKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The full cycle an eligibility instant belongs to. Pure — no I/O.
 */
export function settlementCycleForEligibleDate(eligibleAt: Date): SettlementCycle {
  const { year, month, day } = istParts(eligibleAt);

  // Resolve which (payout month, payout day-of-month slot) this eligibility
  // date feeds, and the [start, end) eligibility window for that slot.
  let payoutYear = year;
  let payoutMonth = month;
  let payoutDom: number;
  let winStartYear: number;
  let winStartMonth: number;
  let winStartDom: number;
  let winEndYear: number;
  let winEndMonth: number;
  let winEndDom: number;

  if (day >= 1 && day <= 7) {
    payoutDom = 9;
    const prev = addMonths(year, month, -1);
    winStartYear = prev.year;
    winStartMonth = prev.month;
    winStartDom = 28;
    winEndYear = year;
    winEndMonth = month;
    winEndDom = 8;
  } else if (day >= 8 && day <= 17) {
    payoutDom = 19;
    winStartYear = year;
    winStartMonth = month;
    winStartDom = 8;
    winEndYear = year;
    winEndMonth = month;
    winEndDom = 18;
  } else if (day >= 18 && day <= 27) {
    payoutDom = 29;
    winStartYear = year;
    winStartMonth = month;
    winStartDom = 18;
    winEndYear = year;
    winEndMonth = month;
    winEndDom = 28;
  } else {
    // 28th–31st: feeds the 9th of next month.
    payoutDom = 9;
    const next = addMonths(year, month, 1);
    payoutYear = next.year;
    payoutMonth = next.month;
    winStartYear = year;
    winStartMonth = month;
    winStartDom = 28;
    winEndYear = next.year;
    winEndMonth = next.month;
    winEndDom = 8;
  }

  // Clamp a "29th" payout to the last day of a short month (February).
  const clampedPayoutDom = Math.min(payoutDom, lastDayOfMonth(payoutYear, payoutMonth));

  const payoutDate = istMidnightInstant(payoutYear, payoutMonth, clampedPayoutDom);
  const windowStart = istMidnightInstant(winStartYear, winStartMonth, winStartDom);
  const windowEnd = istMidnightInstant(winEndYear, winEndMonth, winEndDom);

  return {
    key: isoKey(payoutYear, payoutMonth, clampedPayoutDom),
    payoutDate,
    windowStart,
    windowEnd,
    payoutLabel: fmt(payoutYear, payoutMonth, clampedPayoutDom),
    windowLabel: `${fmt(winStartYear, winStartMonth, winStartDom).replace(/ \d{4}$/, "")} – ${fmt(
      winEndYear,
      winEndMonth,
      // window end is exclusive (the 8th / 18th / 28th) so the last day
      // actually included is the day before.
      winEndDom - 1 >= 1 ? winEndDom - 1 : lastDayOfMonth(winEndYear, winEndMonth),
    )}`,
  };
}

/** Just the frozen payout instant — what upsertSettlementsForSellerOrder writes. */
export function cyclePayoutDateForEligibleDate(eligibleAt: Date): Date {
  return settlementCycleForEligibleDate(eligibleAt).payoutDate;
}

/**
 * Reconstruct a cycle from a stored payout-date key (YYYY-MM-DD, IST) —
 * used by the admin page to render the window label for the selected
 * filter value without re-deriving it from an eligibility date.
 */
export function settlementCycleFromKey(key: string): SettlementCycle | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  // Map the payout day-of-month back to a representative eligibility day
  // squarely inside that slot's feeding window, then rebuild the cycle and
  // verify it round-trips (rejects a key that isn't a real payout date).
  let probeDom: number;
  if (day === 9) probeDom = 3; // 9th slot  <- eligible 28th(prev)–7th
  else if (day === 19) probeDom = 12; // 19th slot <- eligible 8th–17th
  else if (day >= 28) probeDom = 22; // 29th slot (28 in a clamped Feb, or 29/30/31)
  else return null;

  const cycle = settlementCycleForEligibleDate(istMidnightInstant(year, month, probeDom));
  return cycle.key === key ? cycle : null;
}

/**
 * The three cycles around `now` (default: previous 6 payout dates through
 * the next upcoming one), newest first — the raw list the admin filter
 * dropdown falls back to when the DB has no settlements yet.
 */
export function recentSettlementCycles(now: Date = new Date(), back = 6, forward = 1): SettlementCycle[] {
  const { year, month } = istParts(now);
  const seen = new Set<string>();
  const cycles: SettlementCycle[] = [];
  // Walk a generous span of months and collect each month's three slots.
  for (let delta = -Math.ceil((back + 3) / 3) - 1; delta <= Math.ceil(forward / 3) + 1; delta++) {
    const mm = addMonths(year, month, delta);
    for (const dom of [5, 12, 22]) {
      // A representative eligibility day inside each slot's window.
      const probe = istMidnightInstant(mm.year, mm.month, dom);
      const cycle = settlementCycleForEligibleDate(probe);
      if (!seen.has(cycle.key)) {
        seen.add(cycle.key);
        cycles.push(cycle);
      }
    }
  }
  cycles.sort((a, b) => b.payoutDate.getTime() - a.payoutDate.getTime());
  const nowMs = now.getTime();
  const upcoming = [...cycles].reverse().find((c) => c.payoutDate.getTime() >= nowMs);
  const kept = cycles.filter(
    (c) => c.payoutDate.getTime() < nowMs || (upcoming && c.key === upcoming.key),
  );
  return kept.slice(0, back + forward);
}
