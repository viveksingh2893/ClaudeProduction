import { z } from "zod";

// ---------------------------------------------------------------------------
// Category-based seller selling-licence module.
// ---------------------------------------------------------------------------

export const taxonomyNodeTypeEnum = z.enum(["CATEGORY", "SUBCATEGORY", "SUBSUBCATEGORY"]);
export const licenceGeoTypeEnum = z.enum(["PAN_INDIA", "STATE_WISE"]);
export const sellerLicenceAudienceEnum = z.enum(["CUSTOMER", "DEALER", "BOTH"]);
export const licenceStatusEnum = z.enum([
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
]);

export const licenceRequirementInputSchema = z
  .object({
    taxonomyNodeType: taxonomyNodeTypeEnum,
    taxonomyNodeId: z.string().min(1, "Select a taxonomy node"),
    name: z.string().trim().min(2, "Enter a licence name"),
    customerRequired: z.boolean().default(false),
    customerGeoType: licenceGeoTypeEnum.optional(),
    dealerRequired: z.boolean().default(false),
    dealerGeoType: licenceGeoTypeEnum.optional(),
    sameLicenceForBothAudiences: z.boolean().default(false),
    changeReason: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (!data.customerRequired && !data.dealerRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one audience (Customer or Dealer).",
        path: ["customerRequired"],
      });
    }
    if (data.customerRequired && !data.customerGeoType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select Pan India or State-wise for Customer.",
        path: ["customerGeoType"],
      });
    }
    if (data.dealerRequired && !data.dealerGeoType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select Pan India or State-wise for Dealer.",
        path: ["dealerGeoType"],
      });
    }
    if (data.sameLicenceForBothAudiences && (!data.customerRequired || !data.dealerRequired)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"Same licence for Customer and Dealer" requires both audiences to be selected.',
        path: ["sameLicenceForBothAudiences"],
      });
    }
  });
export type LicenceRequirementInput = z.infer<typeof licenceRequirementInputSchema>;

export const licenceRequirementNameUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, "Enter a licence name"),
});
export type LicenceRequirementNameUpdateInput = z.infer<typeof licenceRequirementNameUpdateSchema>;

export const sellerLicenceSubmissionInputSchema = z.object({
  requirementId: z.string().min(1, "Select a licence requirement"),
  audience: sellerLicenceAudienceEnum,
  licenceNumber: z.string().trim().min(1, "Enter the licence number"),
  expiryDate: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now(), "Expiry date must be in the future"),
  // A state-wise licence covers exactly one state per submission — the
  // authoritative "exactly one when the requirement is state-wise, zero
  // when Pan India" check happens server-side in insertSubmission (geo type
  // is a requirement-level fact this schema can't see), but capping the
  // array shape here means a malformed/manually-modified request can never
  // even reach that far with more than one id per audience.
  customerStateIds: z.array(z.string().min(1)).max(1).default([]),
  dealerStateIds: z.array(z.string().min(1)).max(1).default([]),
});
export type SellerLicenceSubmissionInput = z.infer<typeof sellerLicenceSubmissionInputSchema>;

export const licenceDecisionSchema = z
  .object({
    submissionId: z.string().min(1),
    action: z.enum(["APPROVE", "REJECT", "REVOKE"]),
    reason: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if ((data.action === "REJECT" || data.action === "REVOKE") && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reason is required.",
        path: ["reason"],
      });
    }
  });
export type LicenceDecisionInput = z.infer<typeof licenceDecisionSchema>;

export const adminCreateSellerLicenceSubmissionSchema = sellerLicenceSubmissionInputSchema.extend({
  sellerId: z.string().min(1, "Select a seller"),
  autoApprove: z.boolean().default(false),
});
export type AdminCreateSellerLicenceSubmissionInput = z.infer<
  typeof adminCreateSellerLicenceSubmissionSchema
>;
