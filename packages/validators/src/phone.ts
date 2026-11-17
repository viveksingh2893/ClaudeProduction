import { z } from "zod";

/**
 * Kisan4U operates India-only (see BUILD_PHASES.md Phase 2 fixes) — every
 * phone number in the system is stored in one canonical format:
 * "+91" followed by exactly 10 digits, the first of which is 6-9 (the
 * valid Indian mobile leading-digit range). This is the single
 * server-safe normalizer/validator used by every login, OTP, and
 * registration path — never trust client-side formatting, always
 * re-normalize and re-validate here before touching the database.
 */
const INDIA_LOCAL_REGEX = /^[6-9]\d{9}$/;

/**
 * Accepts the legacy/loose shapes a phone might arrive in (bare 10-digit,
 * "91" + 10-digit, "+91" + 10-digit, with stray spaces/dashes) and
 * resolves them all to "+91XXXXXXXXXX". Returns null if the value can't
 * be resolved to a valid Indian mobile number — never guesses, never
 * allows a different country code.
 */
export function normalizeIndianPhone(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s-]/g, "");

  let local: string;
  if (stripped.startsWith("+91")) {
    local = stripped.slice(3);
  } else if (stripped.startsWith("91") && stripped.length === 12) {
    local = stripped.slice(2);
  } else {
    local = stripped;
  }

  if (!INDIA_LOCAL_REGEX.test(local)) return null;
  return `+91${local}`;
}

/** Client-side pre-check only — the server re-validates via `phoneSchema` regardless. */
export function isValidIndianMobileLocal(tenDigits: string): boolean {
  return INDIA_LOCAL_REGEX.test(tenDigits.trim());
}

/**
 * For display only, never for lookup/matching — e.g. distinguishing
 * duplicate customer names in a search-result list without exposing a
 * full phone number to whoever is operating the search UI. Shows the
 * country code and last 2 digits, masks the rest: "+91XXXXXXXX98".
 * Returns the input unchanged if it isn't a normalized "+91XXXXXXXXXX"
 * number (never throws on unexpected shapes).
 */
export function maskIndianPhone(normalized: string): string {
  if (!/^\+91\d{10}$/.test(normalized)) return normalized;
  return `+91${"X".repeat(8)}${normalized.slice(-2)}`;
}

const PHONE_ERROR = "Enter a valid 10-digit Indian mobile number.";

/**
 * The one shared Zod schema for phone input across the whole app —
 * customer login, dealer login, OTP request/verify, dealer registration,
 * account lookups, duplicate-account checks, and seed data all import
 * this. Normalizes on parse, so every downstream consumer receives the
 * canonical "+91XXXXXXXXXX" form regardless of what the client sent.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, PHONE_ERROR)
  .transform((value, ctx) => {
    const normalized = normalizeIndianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
      return z.NEVER;
    }
    return normalized;
  });

/** Password policy shared by any flow that lets a user set/change their own password. */
export const passwordPolicySchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must include at least one lowercase letter")
  .regex(/[A-Z]/, "Password must include at least one uppercase letter")
  .regex(/[0-9]/, "Password must include at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one special character");
