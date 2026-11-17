/**
 * BA referral-code plumbing.
 *
 *   - Every approved BA has a unique "BA-<12 hex>" code (distinct from the
 *     per-user User.referralCode, which this program does not use). 48 bits
 *     of entropy so a code can't be guessed by trying arbitrary strings.
 *   - At registration a new user may supply a code; if it resolves to an
 *     APPROVED / BANK_SUBMITTED BA (not their own, not SUSPENDED) it is
 *     recorded on User.referredByBaId — once, permanently — and a
 *     REGISTRATION earning is accrued.
 *   - Capture is idempotent and never overwrites an existing referrer.
 */

import { randomBytes } from "node:crypto";
import { prisma, type BaStatus } from "@kisan4u/db";
import { isBaProgramEnabled } from "./settings";
import { accrueRegistrationEarning } from "./earnings";

/** "BA-" + 12 uppercase hex chars (6 random bytes). */
export function generateBaReferralCode(): string {
  return `BA-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/** Canonical shape of a valid BA referral code. */
export const BA_REFERRAL_CODE_REGEX = /^BA-[0-9A-F]{12}$/;

/** A code is usable for new referrals only while the BA is live. */
const ACTIVE_BA_STATUSES: BaStatus[] = ["APPROVED", "BANK_SUBMITTED"];

export type ResolvedReferralBa = {
  baId: string;
  userId: string;
  referralCode: string;
};

/**
 * Resolve a raw code (case-insensitive, trimmed) to an active BA, or null.
 * Returns null for an unknown, pending, rejected or SUSPENDED BA — a
 * suspended BA's code simply stops working (spec answer #32).
 */
export async function resolveReferralCode(rawCode: string | null | undefined): Promise<ResolvedReferralBa | null> {
  const code = (rawCode ?? "").trim().toUpperCase();
  if (!BA_REFERRAL_CODE_REGEX.test(code)) return null;
  if (!(await isBaProgramEnabled())) return null;

  const ba = await prisma.businessAssociateProfile.findUnique({
    where: { referralCode: code },
    select: { id: true, userId: true, referralCode: true, status: true },
  });
  if (!ba || !ACTIVE_BA_STATUSES.includes(ba.status)) return null;
  return { baId: ba.id, userId: ba.userId, referralCode: ba.referralCode };
}

/**
 * Attach a referrer to a freshly created user and accrue the registration
 * earning. Safe to call unconditionally after any signup — a blank code, a
 * disabled program, an already-attributed user, or a self-referral are all
 * silent no-ops.
 *
 * @param newUserId  the just-created account
 * @param rawCode    the code they typed (may be null/blank)
 */
export async function applyReferralAtRegistration(
  newUserId: string,
  rawCode: string | null | undefined,
): Promise<{ attributed: boolean }> {
  const resolved = await resolveReferralCode(rawCode);
  if (!resolved) return { attributed: false };

  // Never self-referable — a BA using their own code (directly or via a
  // second number) earns nothing. Same-number is impossible (unique phone);
  // this guards the direct case and the BA's own userId.
  if (resolved.userId === newUserId) return { attributed: false };

  const user = await prisma.user.findUnique({
    where: { id: newUserId },
    select: { id: true, referredByBaId: true },
  });
  if (!user || user.referredByBaId) return { attributed: false };

  await prisma.user.update({
    where: { id: newUserId },
    data: { referredByBaId: resolved.baId },
  });

  await accrueRegistrationEarning({ baId: resolved.baId, referredUserId: newUserId });
  return { attributed: true };
}
