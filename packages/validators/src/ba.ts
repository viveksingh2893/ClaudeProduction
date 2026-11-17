/**
 * Business Associate (BA) program schemas.
 *
 * Form 1 (basic info) — all mandatory, prefilled from what we already hold.
 * Form 2 (KYC + bank)  — all mandatory, gates redemption.
 * Plus admin config (settings + per-seller rate) and the BA "order on
 * behalf of a referred customer" proposed-order flow.
 */

import { z } from "zod";
import { phoneSchema } from "./auth";

const pincode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter a valid 6-digit pincode");

const uploadedDocUrl = z
  .string()
  .regex(/^ba-documents\/[a-z0-9-]+\.(pdf|jpe?g|png|webp)$/i, "Upload the document");

/** Canonical BA referral code: "BA-" + 12 uppercase hex chars. */
export const BA_REFERRAL_CODE_REGEX = /^BA-[0-9A-F]{12}$/;

/** Optional free-form referral code entered at registration / checkout. */
export const referralCodeInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BA_REFERRAL_CODE_REGEX, "That doesn't look like a valid referral code")
  .optional()
  .or(z.literal(""));
export type ReferralCodeInput = z.infer<typeof referralCodeInputSchema>;

// ---------------------------------------------------------------------------
// Form 1 — basic info
// ---------------------------------------------------------------------------
export const baForm1Schema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name"),
  lastName: z.string().trim().min(1, "Enter your last name"),
  contactNumber: phoneSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  pincode,
  state: z.string().trim().min(2, "Select your state"),
  city: z.string().trim().min(2, "Enter your city"),
});
export type BaForm1Input = z.infer<typeof baForm1Schema>;

// ---------------------------------------------------------------------------
// Form 2 — KYC + bank
// ---------------------------------------------------------------------------
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_REGEX = /^\d{6,20}$/;

export const baForm2Schema = z.object({
  panNumber: z.string().trim().toUpperCase().regex(PAN_REGEX, "Enter a valid 10-character PAN"),
  panDocKey: uploadedDocUrl,
  bankName: z.string().trim().min(2, "Enter your bank name"),
  bankBranch: z.string().trim().min(2, "Enter your bank branch"),
  accountHolderName: z.string().trim().min(2, "Enter the account holder's name"),
  accountNumber: z.string().trim().regex(ACCOUNT_NUMBER_REGEX, "Enter a valid bank account number"),
  ifsc: z.string().trim().toUpperCase().regex(IFSC_REGEX, "Enter a valid 11-character IFSC code"),
  chequeDocKey: uploadedDocUrl,
});
export type BaForm2Input = z.infer<typeof baForm2Schema>;

// ---------------------------------------------------------------------------
// Admin — approval, edit, settings, rate config
// ---------------------------------------------------------------------------
export const baAdminDecisionSchema = z.object({
  baId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT", "SUSPEND", "REINSTATE"]),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
export type BaAdminDecisionInput = z.infer<typeof baAdminDecisionSchema>;

/** Admin approve/reject of a BA's submitted bank/KYC details — independent of the Form-1 decision above. */
export const baBankDecisionSchema = z.object({
  baId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
export type BaBankDecisionInput = z.infer<typeof baBankDecisionSchema>;

/** Admin editing every BA field (Form 1 + Form 2), docs optional here. */
export const baAdminEditSchema = baForm1Schema.extend({
  baId: z.string().min(1),
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAN_REGEX, "Enter a valid 10-character PAN")
    .optional()
    .or(z.literal("")),
  panDocKey: uploadedDocUrl.optional().or(z.literal("")),
  bankName: z.string().trim().optional().or(z.literal("")),
  bankBranch: z.string().trim().optional().or(z.literal("")),
  accountHolderName: z.string().trim().optional().or(z.literal("")),
  accountNumber: z
    .string()
    .trim()
    .regex(ACCOUNT_NUMBER_REGEX, "Enter a valid bank account number")
    .optional()
    .or(z.literal("")),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IFSC_REGEX, "Enter a valid 11-character IFSC code")
    .optional()
    .or(z.literal("")),
  chequeDocKey: uploadedDocUrl.optional().or(z.literal("")),
});
export type BaAdminEditInput = z.infer<typeof baAdminEditSchema>;

export const baSettingsSchema = z.object({
  registrationAmount: z.coerce.number().min(0),
  dealerSignupAmount: z.coerce.number().min(0),
  dealerApprovalAmount: z.coerce.number().min(0),
  defaultCommissionPercent: z.coerce.number().min(0).max(100),
  returnWindowHours: z.coerce.number().int().min(0).max(720),
});
export type BaSettingsInput = z.infer<typeof baSettingsSchema>;

export const baRateConfigSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Enter a label"),
  sellerId: z.string().optional().nullable(),
  customerType: z.enum(["CUSTOMER", "DEALER"]).optional().nullable(),
  commissionPercent: z.coerce.number().min(0).max(100),
  isActive: z.boolean().default(true),
});
export type BaRateConfigFormInput = z.infer<typeof baRateConfigSchema>;

export const baProgramToggleSchema = z.object({ enabled: z.boolean() });

// ---------------------------------------------------------------------------
// Proposed order (BA orders on a referred customer's behalf)
// ---------------------------------------------------------------------------
export const proposedOrderLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1),
});

export const proposedOrderCreateSchema = z.object({
  refereeUserId: z.string().min(1, "Choose a customer"),
  // Either an existing saved address of the referee, or a typed one.
  savedAddressId: z.string().optional().nullable(),
  address: z
    .object({
      fullName: z.string().trim().min(2),
      mobile: phoneSchema,
      line1: z.string().trim().min(3),
      line2: z.string().trim().optional().or(z.literal("")),
      landmark: z.string().trim().optional().or(z.literal("")),
      cityTown: z.string().trim().min(2),
      district: z.string().trim().min(2),
      state: z.string().trim().min(2),
      stateId: z.string().min(1),
      pincode,
    })
    .optional()
    .nullable(),
  lines: z.array(proposedOrderLineSchema).min(1, "Add at least one product"),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});
export type ProposedOrderCreateInput = z.infer<typeof proposedOrderCreateSchema>;

export const proposedOrderDecisionSchema = z.object({
  proposedOrderId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT", "CUSTOMIZE"]),
});
export type ProposedOrderDecisionInput = z.infer<typeof proposedOrderDecisionSchema>;
