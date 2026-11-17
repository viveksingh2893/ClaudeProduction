import { z } from "zod";
import { GSTIN_REGEX } from "./gst";

export const applicationDecisionSchema = z.object({
  profileId: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT", "SUSPEND", "REINSTATE"]),
  reason: z.string().trim().max(500).optional(),
});
export type ApplicationDecisionInput = z.infer<typeof applicationDecisionSchema>;

export const userActiveToggleSchema = z.object({
  userId: z.string().min(1),
  isActive: z.boolean(),
});
export type UserActiveToggleInput = z.infer<typeof userActiveToggleSchema>;

/**
 * Admin edit of a customer/dealer's own basic account fields — the
 * identity data every User row has, regardless of role. Phone and email
 * are both optional (many legacy-migrated accounts have only one) but
 * each must be unique across the table when present — the server action
 * surfaces the DB's unique-constraint violation as a friendly error
 * rather than letting it throw.
 */
export const adminUpdateUserDetailsSchema = z.object({
  userId: z.string().min(1),
  firstName: z.string().trim().max(60).optional().or(z.literal("")),
  lastName: z.string().trim().max(60).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});
export type AdminUpdateUserDetailsInput = z.infer<typeof adminUpdateUserDetailsSchema>;

/** Admin edit of a dealer's business/KYC-adjacent profile fields — everything on DealerProfile that isn't the document uploads or the service state (state changes stay on the Dealers list per the existing "Change state" flow). */
export const adminUpdateDealerProfileSchema = z.object({
  profileId: z.string().min(1),
  storeName: z.string().trim().max(150).optional().or(z.literal("")),
  gstNumber: z.string().trim().max(30).optional().or(z.literal("")),
  licenseNumber: z.string().trim().max(60).optional().or(z.literal("")),
  storeAddress: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  pincode: z.string().trim().max(10).optional().or(z.literal("")),
});
export type AdminUpdateDealerProfileInput = z.infer<typeof adminUpdateDealerProfileSchema>;

/**
 * Admin edit of a seller's onboarding / business profile — the same
 * fields the "Become a Seller" application collects, minus the two
 * document uploads (view-only for the admin; the files live on the
 * storefront origin). GST number and IFSC are format-checked only when
 * present so the admin can save a partially-corrected profile.
 */
export const adminUpdateSellerProfileSchema = z.object({
  profileId: z.string().min(1),
  companyName: z.string().trim().min(2, "Enter the company name").max(150),
  contactPersonName: z.string().trim().max(120).optional().or(z.literal("")),
  companyWebsite: z
    .string()
    .trim()
    .url("Enter a valid website URL")
    .max(200)
    .optional()
    .or(z.literal("")),
  registeredAddress: z.string().trim().max(400).optional().or(z.literal("")),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(160)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email address"),
  contactMobile: z
    .string()
    .trim()
    .max(20)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^[0-9]{7,15}$/.test(v), "Enter a valid mobile number (digits only)"),
  sellingStateIds: z.array(z.string().min(1)).default([]),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || GSTIN_REGEX.test(v), "Enter a valid 15-character GST number"),
  bankName: z.string().trim().max(120).optional().or(z.literal("")),
  accountHolderName: z.string().trim().max(120).optional().or(z.literal("")),
  accountNumber: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^\d{6,20}$/.test(v), "Enter a valid bank account number"),
  ifscCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Enter a valid 11-character IFSC code"),
  bankBranch: z.string().trim().max(120).optional().or(z.literal("")),
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(10)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "Enter a valid 10-character PAN"),
});
export type AdminUpdateSellerProfileInput = z.infer<typeof adminUpdateSellerProfileSchema>;

export const percentSchema = z.coerce.number().min(0, "Must be zero or greater").max(100, "Must be 100 or less");

/**
 * A seller's commission rate is split by buyer type — `commissionPercent`
 * applies to CUSTOMER (customer) orders, `dealerCommissionPercent` to
 * DEALER orders (matches `SellerOrder.customerType`) — so admin can set
 * e.g. 10% for customer orders and 5% for dealer orders on the same
 * seller independently.
 */
export const sellerCommissionInputSchema = z.object({
  profileId: z.string().min(1),
  commissionPercent: percentSchema,
  dealerCommissionPercent: percentSchema,
});
export type SellerCommissionInput = z.infer<typeof sellerCommissionInputSchema>;

// --- RBAC: roles + employee accounts ----------------------------------

export const roleCreateSchema = z.object({
  name: z.string().trim().min(1, "Enter a role name").max(60),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const permissionActionSchema = z.enum(["VIEW", "CREATE", "EDIT", "DELETE"]);

export const rolePermissionsUpdateSchema = z.object({
  roleId: z.string().min(1),
  grants: z.array(
    z.object({ module: z.string().min(1), action: permissionActionSchema, granted: z.boolean() }),
  ),
});
export type RolePermissionsUpdateInput = z.infer<typeof rolePermissionsUpdateSchema>;

// Same login path as a seller (email + password, apps/dashboard only) —
// no phone-OTP option, so phone stays optional here purely as a contact
// detail, not a login credential.
export const employeeCreateSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(60),
  lastName: z.string().trim().min(1, "Enter a last name").max(60),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  roleId: z.string().min(1, "Select a role"),
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z.object({
  userId: z.string().min(1),
  firstName: z.string().trim().min(1, "Enter a first name").max(60),
  lastName: z.string().trim().min(1, "Enter a last name").max(60),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  roleId: z.string().min(1, "Select a role"),
});
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
