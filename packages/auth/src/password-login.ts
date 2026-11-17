import bcrypt from "bcryptjs";
import { prisma, type UserRole } from "@kisan4u/db";
import { passwordLoginSchema } from "@kisan4u/validators";

/**
 * Same email+password check as providers/password-credentials.ts's
 * `authorize()` (seller/admin login on apps/dashboard), factored out as a
 * plain function so the mobile bearer-token login route can call it
 * without going through NextAuth's Credentials/Session machinery, which
 * is cookie-based and not meaningful for a mobile client. Deliberately
 * kept as the exact same four checks (user exists, has a password hash,
 * is active, role is ADMIN or SELLER, hash matches) so the two entry
 * points can never silently diverge on who's allowed to log in.
 */
export type PasswordLoginResult =
  | {
      ok: true;
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        role: UserRole;
        sessionVersion: number;
      };
    }
  | { ok: false; error: string };

export async function verifyPasswordLogin(
  rawEmail: string,
  rawPassword: string,
): Promise<PasswordLoginResult> {
  const parsed = passwordLoginSchema.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email or password." };
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !user.isActive) {
    return { ok: false, error: "Invalid email or password." };
  }
  if (user.role !== "ADMIN" && user.role !== "SELLER") {
    return { ok: false, error: "Invalid email or password." };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return { ok: false, error: "Invalid email or password." };

  return {
    ok: true,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      sessionVersion: user.sessionVersion,
    },
  };
}
