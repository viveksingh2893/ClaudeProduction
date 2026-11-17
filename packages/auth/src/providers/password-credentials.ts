import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@kisan4u/db";
import { passwordLoginSchema } from "@kisan4u/validators";

/**
 * Email+password login for admin, seller, and staff (`apps/dashboard`).
 * Any account with role ADMIN, SELLER, or STAFF and a set passwordHash can
 * use this — the dashboard doesn't need a role selector, it redirects
 * post-login based on the DB-stored role.
 *
 * Phase 1 scope: no seller-approval-status gating here — that's a
 * business-module concern deferred to BUILD_PHASES.md Phase 10.
 */
export const passwordCredentialsProvider = Credentials({
  id: "password",
  name: "Email & Password",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(rawCredentials) {
    const parsed = passwordLoginSchema.safeParse(rawCredentials);
    if (!parsed.success) return null;
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !user.isActive) return null;
    if (user.role !== "ADMIN" && user.role !== "SELLER" && user.role !== "STAFF") return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      email: user.email ?? undefined,
      sessionVersion: user.sessionVersion,
    };
  },
});
