import Credentials from "next-auth/providers/credentials";
import { mobileVerifyOtpWithNameSchema } from "@kisan4u/validators";
import { verifyOtpAndResolveUser } from "../otp-login";
import { getTrustedClientIp } from "../otp";

/**
 * Phone-OTP login for the two roles that use it: customer/customer and
 * dealer (`apps/web`). The `role` credential is client-supplied but is
 * only ever used to REJECT a mismatched login (e.g. a customer trying the
 * dealer page) — the role actually granted in the session always comes
 * from the DB (`user.role`), never from client input, so this is safe.
 *
 * CUSTOMER logins auto-provision a new account on first successful OTP
 * (delegated to verifyOtpAndResolveUser, shared with the mobile API) —
 * matches the reference business flow ("Customer visits website/app →
 * Creates ID/login"). DEALER still requires the KYC registration flow
 * (registerDealer in ./registration.ts) before any login is possible;
 * verifyOtpAndResolveUser never auto-creates a DEALER account.
 */
export const otpCredentialsProvider = Credentials({
  id: "otp",
  name: "Phone OTP",
  credentials: {
    phone: { label: "Phone", type: "text" },
    code: { label: "OTP", type: "text" },
    role: { label: "Role", type: "text" },
    purpose: { label: "Purpose", type: "text" },
  },
  async authorize(rawCredentials, request) {
    const parsed = mobileVerifyOtpWithNameSchema.safeParse(rawCredentials);
    if (!parsed.success) return null;
    const { phone, code, role, purpose } = parsed.data;

    const result = await verifyOtpAndResolveUser(phone, code, role, undefined, {
      purpose: purpose ?? "login",
      ip: getTrustedClientIp(request.headers),
    });
    if (!result.ok) return null;

    return {
      id: result.user.id,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role,
      sessionVersion: result.user.sessionVersion,
    };
  },
});
