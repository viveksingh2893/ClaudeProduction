import { z } from "zod";
import { phoneSchema, passwordPolicySchema } from "./phone";

export {
  phoneSchema,
  normalizeIndianPhone,
  isValidIndianMobileLocal,
  maskIndianPhone,
  passwordPolicySchema,
} from "./phone";

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "OTP must be 6 digits");

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["login", "guest_checkout"]).optional(),
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const otpRoleSchema = z.enum(["CUSTOMER", "DEALER"]);
export type OtpRole = z.infer<typeof otpRoleSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  role: otpRoleSchema,
  purpose: z.enum(["login", "guest_checkout"]).optional(),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/** Mobile-only: OTP verify also accepts an optional display name, used when it auto-provisions a new CUSTOMER account (see packages/auth/src/otp-login.ts). */
export const verifyOtpWithNameSchema = verifyOtpSchema.extend({
  name: z.string().trim().min(1).max(120).optional(),
});
export const mobileVerifyOtpWithNameSchema = verifyOtpWithNameSchema.extend({
  role: otpRoleSchema.optional(),
});
export type VerifyOtpWithNameInput = z.infer<typeof verifyOtpWithNameSchema>;

export const passwordLoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;

/**
 * Self-service password change (forced after an admin reset, or any future
 * voluntary change) — full complexity policy applies to the new password,
 * and it must be typed twice to catch a typo before it's hashed (there's
 * no way to recover from a mistyped password once saved, since only the
 * hash is ever stored). "New password can't equal the current one" is
 * NOT checked here — that requires comparing against the live bcrypt hash,
 * which only packages/auth/src/password-reset.ts:changeOwnPassword can do.
 */
export const changePasswordSchema = z
  .object({
    newPassword: passwordPolicySchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(60),
  lastName: z.string().trim().max(60).optional().or(z.literal("")),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
