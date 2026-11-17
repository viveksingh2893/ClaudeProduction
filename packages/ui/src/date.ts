/**
 * The one shared date-formatting utility for the selling-licence module
 * (and anywhere else that wants DD/MM/YYYY) — every page previously called
 * `.toLocaleDateString()` with no locale argument, which renders MM/DD/YYYY
 * on a US-locale browser/server and is exactly the format the spec calls
 * out as wrong. Never format a licence date any other way.
 *
 * Always reads UTC date parts, never local ones — expiry/submission dates
 * are date-only values (e.g. from an `<input type="date">`, parsed as UTC
 * midnight), and reading them with local getters would shift the displayed
 * day backward for any browser/server timezone behind UTC.
 */
export function formatDateDDMMYYYY(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * DD/MM/YYYY HH:MM for audit-trail style timestamps where the moment, not
 * just the day, matters (e.g. "last recalculated", "submitted on"). Both
 * the date and the 24-hour time are rendered in IST (Asia/Kolkata) — every
 * deployment of this app is India-only — regardless of the server's or
 * browser's own timezone, so a real UTC-stored instant shows the wall
 * clock an Indian user expects. Unlike formatDateDDMMYYYY (which is for
 * date-only values parsed as UTC midnight), pass this a genuine timestamp.
 */
export function formatDateTimeDDMMYYYY(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // en-GB gives "24" for midnight in some engines — normalise to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("day")}/${get("month")}/${get("year")} ${hour}:${get("minute")}`;
}

export type ParsedDateResult = { ok: true; date: Date } | { ok: false; error: string };

/**
 * Strict DD/MM/YYYY text parser — for any text-based date input (as
 * opposed to a native `<input type="date">`, which is locale-agnostic
 * ISO under the hood and never needs this). Rejects malformed input and
 * impossible calendar dates (e.g. 31/02/2027) rather than letting
 * JavaScript's `Date` silently roll them over into the next month.
 */
export function parseDDMMYYYY(text: string): ParsedDateResult {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return { ok: false, error: "Enter the date as DD/MM/YYYY." };
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return { ok: false, error: "Enter a valid month (01–12)." };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth)
    return { ok: false, error: `${match[2]}/${match[3]} only has ${daysInMonth} days.` };
  const date = new Date(Date.UTC(year, month - 1, day));
  return { ok: true, date };
}

/** Converts a Date (or date-only ISO string) to the value a native `<input type="date">` expects (YYYY-MM-DD), reading UTC parts for the same timezone-safety reason as formatDateDDMMYYYY. */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}
