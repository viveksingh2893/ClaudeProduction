import { prisma, type UserRole } from "@kisan4u/db";
import { verifyOtp } from "./otp";
import { splitFullName } from "./name-split";

export type OtpLoginRole = "CUSTOMER" | "DEALER";

export type OtpLoginResult =
  | {
      ok: true;
      isNewAccount: boolean;
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        role: UserRole;
        sessionVersion: number;
      };
    }
  | { ok: false; error: string; code?: "RATE_LIMITED"; retryAfter?: number };

/**
 * Mobile OTP verify. For an EXISTING phone this is exactly
 * otpCredentialsProvider's authorize() logic (role must match, account
 * must be active), just returning a plain result instead of a NextAuth
 * `User`/`null`.
 *
 * For a phone with no account and role=CUSTOMER, this auto-provisions a
 * new CUSTOMER user. That's a deliberate, additive difference from the
 * website today: apps/web's OTP sign-in (packages/auth/src/providers/
 * otp-credentials.ts) requires the user to already exist — there is
 * currently no self-service customer registration anywhere in the
 * rebuild (dealer and seller both have dedicated registration flows,
 * plain customers don't yet). The reference business flow
 * (kisan4u_basic_flow.docx "Customer visits website/app → Creates ID/login")
 * expects a customer to be able to sign up this way, so the mobile app
 * implements it here rather than leaving customer signup entirely
 * unreachable. It never touches an existing row and never applies to
 * DEALER (dealer accounts still require the KYC registration flow —
 * registerDealer in ./registration.ts — before any login is possible).
 */
export async function verifyOtpAndResolveUser(
  phone: string,
  code: string,
  role: OtpLoginRole | undefined,
  newAccountName?: string,
  context: { purpose: "login" | "guest_checkout"; ip: string } = {
    purpose: "login",
    ip: "unknown",
  },
): Promise<OtpLoginResult> {
  const codeValid = await verifyOtp(phone, code, context);
  if (!codeValid.ok) {
    return {
      ok: false,
      error:
        codeValid.code === "RATE_LIMITED"
          ? `Too many incorrect codes. Try again in ${codeValid.retryAfter} seconds.`
          : "Invalid or expired OTP.",
      ...(codeValid.code === "RATE_LIMITED"
        ? { code: "RATE_LIMITED" as const, retryAfter: codeValid.retryAfter }
        : {}),
    };
  }

  const existing = await prisma.user.findUnique({ where: { phone } });

  if (existing) {
    if (role && existing.role !== role) {
      return {
        ok: false,
        error: `This number is registered as a ${existing.role.toLowerCase()} account. Log in from the ${existing.role === "DEALER" ? "dealer" : "customer"} tab instead.`,
      };
    }
    if (!existing.isActive)
      return { ok: false, error: "This account has been deactivated. Contact support." };
    if (existing.role !== "CUSTOMER" && existing.role !== "DEALER") {
      return {
        ok: false,
        error: `This number belongs to a ${existing.role.toLowerCase()} account. Use email and password to log in.`,
      };
    }
    if (existing.role === "DEALER") {
      const dealer = await prisma.dealerProfile.findUnique({
        where: { userId: existing.id },
        select: { status: true },
      });
      if (dealer?.status === "SUSPENDED") {
        return { ok: false, error: "This dealer account is suspended. Contact support." };
      }
    }
    return {
      ok: true,
      isNewAccount: false,
      user: {
        id: existing.id,
        firstName: existing.firstName,
        lastName: existing.lastName,
        role: existing.role,
        sessionVersion: existing.sessionVersion,
      },
    };
  }

  if (role === "DEALER") {
    return {
      ok: false,
      error: "No dealer account found for this number. Please complete dealer registration first.",
    };
  }

  // Mobile-only optional display name at signup (see verifyOtpWithNameSchema)
  // — a single "full name" field for low-friction signup, split here with
  // the same first-space convention as the legacy-data backfill. Absent
  // entirely (web's OTP sign-in never collects a name at all) means both
  // stay null, exactly like a real phone-only legacy account.
  const { firstName, lastName } = newAccountName?.trim()
    ? splitFullName(newAccountName)
    : { firstName: null, lastName: null };
  const referralCode = `CUS-${Date.now().toString(36).toUpperCase()}`;
  const created = await prisma.user.create({
    data: {
      phone,
      firstName,
      lastName,
      role: "CUSTOMER",
      isPhoneVerified: true,
      referralCode,
    },
  });

  return {
    ok: true,
    isNewAccount: true,
    user: {
      id: created.id,
      firstName: created.firstName,
      lastName: created.lastName,
      role: created.role,
      sessionVersion: created.sessionVersion,
    },
  };
}
