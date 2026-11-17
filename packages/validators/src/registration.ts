import { z } from "zod";
import { phoneSchema, otpCodeSchema } from "./auth";
import { gstNumberSchema, GSTIN_REGEX } from "./gst";

// Phase 2 fix: verifying the OTP is now a separate step from submitting
// the registration form (see packages/auth/src/onboarding.ts) — this
// schema validates just that step.
export const verifyDealerOtpSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
});
export type VerifyDealerOtpInput = z.infer<typeof verifyDealerOtpSchema>;

// Deliberately has NO `phone` or `code` field: the phone this
// registration belongs to is never taken from client input at this
// stage — it's resolved server-side from the OTP-verified onboarding
// session (see packages/auth/src/onboarding.ts and
// apps/web/src/app/register/dealer/details/actions.ts). A client could
// submit any `phone` value here and the server would simply ignore it.
//
// KYC uploads return opaque private-storage keys. They never contain an
// absolute path or a public /api/uploads URL.
const uploadedDocUrlSchema = z
  .string()
  .regex(
    /^(dealer-documents|seller-documents)\/[a-z0-9-]+\.(pdf|jpe?g|png|webp)$/i,
    "Invalid document reference",
  )
  .optional()
  .or(z.literal(""));

/** Same shape as uploadedDocUrlSchema but the upload is mandatory — used by the seller application, where the GST certificate and PAN card are required. */
const requiredUploadedDocUrlSchema = z
  .string()
  .regex(
    /^(dealer-documents|seller-documents)\/[a-z0-9-]+\.(pdf|jpe?g|png|webp)$/i,
    "Upload the document",
  );

export const dealerRegistrationSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name"),
  storeName: z.string().trim().min(2, "Enter your store name"),
  storeAddress: z.string().trim().min(5, "Enter your store address"),
  city: z.string().trim().min(2, "Enter your city"),
  // Free-text state is kept only for display/back-compat — `stateId` is
  // the authoritative, server-validated value used for dealer catalogue
  // filtering (see packages/auth/src/registration.ts). Required: a dealer
  // must pick one state before submitting registration.
  stateId: z.string().min(1, "Select your state"),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),
  // Format-validated when present — a valid GSTIN is what lets the server
  // derive/lock the authoritative state (see packages/auth/src/registration.ts),
  // overriding whatever `stateId` the client sent.
  gstNumber: gstNumberSchema,
  // A drug/agri-input licence number + its scanned copy are mandatory for
  // a new dealer application (the admin edit path below loosens this again
  // so a legacy dealer without one on file can still be edited).
  licenseNumber: z.string().trim().min(3, "Enter your licence number"),
  gstDocUrl: uploadedDocUrlSchema,
  licenseDocUrl: requiredUploadedDocUrlSchema,
});
export type DealerRegistrationInput = z.infer<typeof dealerRegistrationSchema>;

/**
 * A logged-in customer applying to become a dealer (or editing / resubmitting
 * a still-pending application), and an admin editing a dealer's business
 * profile — all use the exact same field set as the initial registration
 * form. Kept as a named alias so those call sites don't reach for the
 * "registration" name.
 */
export const dealerApplicationSchema = dealerRegistrationSchema;
export type DealerApplicationInput = DealerRegistrationInput;

/**
 * Admin "Convert to dealer" from the customers table — the application
 * fields plus the target customer's user id. Licence number / copy stay
 * optional here (same reasoning as dealerProfileEditSchema): an admin
 * converting a customer often does not have the document in hand, and the
 * dealer can supply it on their own detail page afterwards.
 */
export const adminConvertToDealerSchema = dealerRegistrationSchema.extend({
  userId: z.string().min(1),
  licenseNumber: z.string().trim().optional().or(z.literal("")),
  licenseDocUrl: uploadedDocUrlSchema,
});
export type AdminConvertToDealerInput = z.infer<typeof adminConvertToDealerSchema>;

/**
 * Admin edit of an existing DealerProfile (routed through the pending-changes
 * approval gate for an APPROVED dealer) — application fields plus the profile
 * id. Licence number / copy are loosened back to optional here: many legacy
 * dealers predate the mandatory-licence rule and an admin must still be able
 * to edit their other details without being forced to supply one.
 */
export const dealerProfileEditSchema = dealerRegistrationSchema.extend({
  profileId: z.string().min(1),
  licenseNumber: z.string().trim().optional().or(z.literal("")),
  licenseDocUrl: uploadedDocUrlSchema,
});
export type DealerProfileEditInput = z.infer<typeof dealerProfileEditSchema>;

/** Mobile only: dealer registration submit also carries the onboarding ticket id in the body instead of an httpOnly cookie (mobile has no meaningful cookie jar) — see packages/auth/src/onboarding.ts. */
export const dealerRegistrationWithSessionSchema = dealerRegistrationSchema.extend({
  onboardingSessionId: z.string().min(1),
});
export type DealerRegistrationWithSessionInput = z.infer<
  typeof dealerRegistrationWithSessionSchema
>;

/**
 * The "Become a Seller" application (apps/web/src/app/seller/apply). No
 * password — a seller has no login until an admin approves them and issues
 * a temporary password (see packages/auth/src/access.ts's
 * approveSellerApplication). Every field is required except the website.
 */
export const sellerRegistrationSchema = z.object({
  companyName: z.string().trim().min(2, "Enter your company name"),
  contactPersonName: z.string().trim().min(2, "Enter the contact person's name"),
  companyWebsite: z
    .string()
    .trim()
    .url("Enter a valid website URL (including https://)")
    .optional()
    .or(z.literal("")),
  mobileNumber: phoneSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // Opaque ticket from verifySellerApplyOtpAction — proves the mobile
  // number above was just OTP-verified (see packages/auth/src/
  // phone-verification-token.ts). registerSeller checks the embedded phone
  // matches mobileNumber.
  phoneVerificationToken: z.string().min(1, "Verify your mobile number to continue"),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, "Enter a valid 15-character GST number"),
  gstDocUrl: requiredUploadedDocUrlSchema,
  // Structured registered address (replaces the old single free-text blob).
  registeredAddressLine1: z.string().trim().min(3, "Enter address line 1"),
  registeredAddressLine2: z.string().trim().max(200).optional().or(z.literal("")),
  registeredCity: z.string().trim().min(2, "Enter the city"),
  registeredDistrict: z.string().trim().min(2, "Enter the district"),
  registeredState: z.string().trim().min(2, "Select the state"),
  registeredPincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),
  bankName: z.string().trim().min(2, "Enter your bank name"),
  accountHolderName: z.string().trim().min(2, "Enter the account holder's name"),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, "Enter a valid bank account number"),
  ifscCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC code"),
  bankBranch: z.string().trim().min(2, "Enter the bank branch"),
  panDocUrl: requiredUploadedDocUrlSchema,
});
export type SellerRegistrationInput = z.infer<typeof sellerRegistrationSchema>;
