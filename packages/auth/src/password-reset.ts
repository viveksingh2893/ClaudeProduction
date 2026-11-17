import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, type UserRole } from "@kisan4u/db";
import { changePasswordSchema, type ChangePasswordInput } from "@kisan4u/validators";
import { BCRYPT_SALT_ROUNDS } from "./registration";

// Deliberately excludes visually-ambiguous characters (0/O, 1/l/I) — an
// admin reads this string aloud or copies it once to hand to a seller, and
// a misread character means a failed first login. Still satisfies every
// class passwordPolicySchema requires (lower/upper/digit/special).
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SPECIAL = "!@#$%^&*?";
const ALL = LOWER + UPPER + DIGITS + SPECIAL;
const TEMP_PASSWORD_LENGTH = 14;

function randomChar(pool: string): string {
  return pool[crypto.randomInt(pool.length)]!;
}

/**
 * Cryptographically random (node:crypto.randomInt, never Math.random) —
 * guarantees at least one character of every class passwordPolicySchema
 * requires by construction (not left to chance), then fills the rest from
 * the full pool and shuffles with a crypto-random Fisher-Yates so the
 * guaranteed characters aren't predictably in the first four positions.
 */
export function generateTemporaryPassword(): string {
  const required = [randomChar(LOWER), randomChar(UPPER), randomChar(DIGITS), randomChar(SPECIAL)];
  const rest = Array.from({ length: TEMP_PASSWORD_LENGTH - required.length }, () =>
    randomChar(ALL),
  );
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

export type AdminResetPasswordResult =
  { ok: true; temporaryPassword: string } | { ok: false; error: string };

/**
 * Admin-only — the caller's Server Action must independently verify the
 * actor is an admin before calling this (same convention as every other
 * function in access.ts). Issues a fresh random temporary password,
 * forces the account to change it on next login (`mustChangePassword`,
 * enforced live on every request — see access.ts:validateUserSession /
 * apps/dashboard/src/lib/session-guard.ts), and bumps `sessionVersion` so
 * any session issued under the OLD password is invalidated immediately —
 * a currently-logged-in session (possibly on a device the seller no
 * longer controls, which is exactly the scenario a password reset is
 * often used for) can't keep riding along after the reset.
 *
 * The plaintext temporary password is returned exactly once, to the admin
 * who requested it — it is never stored, logged, or retrievable again
 * after this call returns (only its bcrypt hash is persisted).
 */
export async function adminResetPassword(
  userId: string,
  actor: { id: string; role: UserRole },
): Promise<AdminResetPasswordResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return { ok: false, error: "Account not found." };
  if (user.role !== "ADMIN" && user.role !== "SELLER" && user.role !== "STAFF") {
    return { ok: false, error: "Only admin, seller, and staff accounts use password login." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      actorRole: actor.role,
      action: "PASSWORD_RESET_BY_ADMIN",
      entityType: "User",
      entityId: userId,
      // Never the password itself — the trail records that a reset
      // happened and who did it, not what the new secret is.
      metadata: {},
    },
  });

  return { ok: true, temporaryPassword };
}

export type ChangeOwnPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Self-service completion of a forced (or, later, voluntary) password
 * change. Rejects a new password identical to the current one — compared
 * via bcrypt.compare against the live hash, never a plaintext history
 * table, since only the hash is ever stored — so a forced reset can't be
 * "completed" by resubmitting the same temporary password back, and this
 * is also where "no two passwords the same" is actually enforced (the
 * validators-level changePasswordSchema can only check the two *typed*
 * fields match each other, not compare against the stored hash).
 *
 * Deliberately does NOT bump `sessionVersion` — unlike adminResetPassword,
 * this runs inside the very session that must survive the change (the
 * user is completing the forced /change-password flow in that session);
 * bumping it here would immediately fail that session's own next
 * `validateUserSession` check and boot the user right back to /login.
 */
export async function changeOwnPassword(
  userId: string,
  rawInput: ChangePasswordInput,
): Promise<ChangeOwnPasswordResult> {
  const parsed = changePasswordSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) return { ok: false, error: "Account not found." };

  const sameAsCurrent = await bcrypt.compare(parsed.data.newPassword, user.passwordHash);
  if (sameAsCurrent) {
    return { ok: false, error: "Your new password must be different from your current password." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });

  return { ok: true };
}
