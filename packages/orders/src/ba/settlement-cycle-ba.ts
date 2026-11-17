/**
 * BA payout cycle — once a month, on the last calendar day of the month
 * (spec answer #33: "same way as seller settlement, just once a month at
 * the end of the month"). All boundaries in IST (fixed UTC+5:30, no DST).
 *
 * An earning that became ELIGIBLE in month M is paid in month M's batch,
 * whose payout instant is 00:00 IST on the 1st of month M+1 (i.e. just
 * after the last day of M closes). The admin runs the batch on/after that
 * date; earnings that go eligible later fall into a later month.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function istParts(d: Date): { year: number; month: number; day: number } {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth(), day: s.getUTCDate() };
}

function istMidnightInstant(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** "YYYY-MM" (IST) — the payout batch key for the month an instant falls in. */
export function payoutMonthKey(d: Date): string {
  const { year, month } = istParts(d);
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export type BaPayoutCycle = {
  /** "YYYY-MM" */
  key: string;
  /** e.g. "September 2026" */
  label: string;
  /** First instant of the month (00:00 IST on the 1st). */
  monthStart: Date;
  /** First instant after the month (00:00 IST on the 1st of the next month) — also the payout instant. */
  payoutDate: Date;
  /** e.g. "30 Sep 2026" — the last eligible day, for display. */
  lastDayLabel: string;
};

export function baPayoutCycleFromKey(key: string): BaPayoutCycle | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;

  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const last = lastDayOfMonth(year, month);

  return {
    key,
    label: `${monthName(month)} ${year}`,
    monthStart: istMidnightInstant(year, month, 1),
    payoutDate: istMidnightInstant(nextYear, nextMonth, 1),
    lastDayLabel: `${last} ${MONTHS[month]} ${year}`,
  };
}

export function baPayoutCycleForDate(d: Date): BaPayoutCycle {
  return baPayoutCycleFromKey(payoutMonthKey(d))!;
}

function monthName(month0: number): string {
  return [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month0]!;
}

/** The last `count` month cycles up to and including the current one, newest first. */
export function recentBaPayoutCycles(now: Date = new Date(), count = 12): BaPayoutCycle[] {
  const { year, month } = istParts(now);
  const out: BaPayoutCycle[] = [];
  for (let i = 0; i < count; i++) {
    const total = year * 12 + month - i;
    const y = Math.floor(total / 12);
    const mm = ((total % 12) + 12) % 12;
    out.push(baPayoutCycleFromKey(`${y}-${String(mm + 1).padStart(2, "0")}`)!);
  }
  return out;
}
