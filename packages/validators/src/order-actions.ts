import { z } from "zod";
import { phoneSchema } from "./phone";
import { pincodeSchema } from "./address";
import { moneySchema, mediaUrlSchema } from "./primitives";

// --- Seller order workflow -------------------------------------------------

export const acceptOrderInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  pickupPointId: z.string().min(1, "Select a pickup point"),
});
export type AcceptOrderInput = z.infer<typeof acceptOrderInputSchema>;

export const markPackedInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  packageCount: z.coerce.number().int().min(1).optional(),
});
export type MarkPackedInput = z.infer<typeof markPackedInputSchema>;

export const schedulePickupInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  // Only needed as a recovery path for an order whose pickup point was
  // never set — e.g. an admin manual status override moved it straight to
  // SELLER_ACCEPTED/PACKED without going through acceptOrder. Ignored if
  // the order already has a pickup point.
  pickupPointId: z.string().min(1).optional(),
});
export type SchedulePickupInput = z.infer<typeof schedulePickupInputSchema>;

// --- Admin: RapidShyp dispatch ----------------------------------------------

// Package dimensions aren't captured anywhere upstream (no field on
// Shipment or SellerOrder holds them) — admin enters them fresh each time
// they push an order to RapidShyp, per product decision.
export const sendToRapidShypInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  packageLengthCm: z.coerce.number().positive("Enter package length"),
  packageBreadthCm: z.coerce.number().positive("Enter package breadth"),
  packageHeightCm: z.coerce.number().positive("Enter package height"),
  packageWeightGrams: z.coerce.number().positive("Enter package weight"),
});
export type SendToRapidShypInput = z.infer<typeof sendToRapidShypInputSchema>;

// Kisan4U has three Delhivery accounts, each its own API token — the user
// picks which one a shipment is booked on. Every downstream call for that
// shipment (label / track / cancel) must use the same account.
export const delhiveryAccountEnum = z.enum(["MARKETING1", "SURFACE_500G", "SURFACE_1"]);
export type DelhiveryAccount = z.infer<typeof delhiveryAccountEnum>;

export const sendToDelhiveryInputSchema = sendToRapidShypInputSchema.extend({
  delhiveryAccount: delhiveryAccountEnum,
});
export type SendToDelhiveryInput = z.infer<typeof sendToDelhiveryInputSchema>;

// --- Dispatch wizard (Create Shipment) ------------------------------------
// One input for the 4-step "Create Shipment" modal (admin + seller order
// tables): pick a logistics partner, a pickup warehouse, and enter the
// package dimensions. Runs accept + pack + schedule as one action.
export const dispatchViaWizardInputSchema = z
  .object({
    sellerOrderId: z.string().min(1),
    partner: z.enum(["RAPIDSHYP", "DELHIVERY", "MOCK"]),
    pickupPointId: z.string().min(1, "Choose a pickup warehouse"),
    // Only meaningful (and required) when partner === "DELHIVERY".
    delhiveryAccount: delhiveryAccountEnum.optional(),
    packageLengthCm: z.coerce.number().positive("Enter package length"),
    packageBreadthCm: z.coerce.number().positive("Enter package breadth"),
    packageHeightCm: z.coerce.number().positive("Enter package height"),
    packageWeightGrams: z.coerce.number().positive("Enter package weight"),
  })
  .superRefine((data, ctx) => {
    if (data.partner === "DELHIVERY" && !data.delhiveryAccount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a Delhivery account.",
        path: ["delhiveryAccount"],
      });
    }
  });
export type DispatchViaWizardInput = z.infer<typeof dispatchViaWizardInputSchema>;

// Keyed by refundRequestId — the return-pickup counterpart to
// sendToRapidShypInputSchema. Package dims are OPTIONAL: an auto-booked
// return pickup (on the admin approving the return — refunds.ts's
// decideReturnRequest) estimates them from the item (return-package.ts);
// the manual "retry pickup" admin form still passes exact figures, which
// win. Same shape reused for Delhivery.
export const sendReturnToRapidShypInputSchema = z.object({
  refundRequestId: z.string().min(1),
  packageLengthCm: z.coerce.number().positive().optional(),
  packageBreadthCm: z.coerce.number().positive().optional(),
  packageHeightCm: z.coerce.number().positive().optional(),
  packageWeightGrams: z.coerce.number().positive().optional(),
});
export type SendReturnToRapidShypInput = z.infer<typeof sendReturnToRapidShypInputSchema>;

export const sendReturnToDelhiveryInputSchema = sendReturnToRapidShypInputSchema;
export type SendReturnToDelhiveryInput = z.infer<typeof sendReturnToDelhiveryInputSchema>;

/** Provider-agnostic: the reverse-pickup dispatcher (arrangeReturnPickup) picks the courier from the order's own shipment. */
export const arrangeReturnPickupInputSchema = sendReturnToRapidShypInputSchema;
export type ArrangeReturnPickupInput = z.infer<typeof arrangeReturnPickupInputSchema>;

export const sellerRejectOrderInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  reason: z.string().trim().min(3, "Enter a reason").max(300),
});
export type SellerRejectOrderInput = z.infer<typeof sellerRejectOrderInputSchema>;

// --- Cancellation -----------------------------------------------------------

// Narrower than the post-delivery return flow's refundMethodEnum below —
// BANK_TRANSFER never applies here. That option exists specifically for a
// COD order with no electronic payment source, but COD never collects
// anything before delivery, and cancellation is always pre-delivery, so
// there's never COD cash to refund at this point (see cancellation.ts's
// validateCancellationRefundMethod, the actual authority this mirrors).
export const cancellationRefundMethodEnum = z.enum(["WALLET", "ORIGINAL_SOURCE"]);

export const cancellationRequestInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  reason: z.string().trim().min(3, "Enter a reason").max(300),
  // Only required when requestCancellation finds real, non-wallet money
  // already captured for this order — omitted (and ignored) for an unpaid
  // COD order or one paid entirely from the wallet. Re-validated
  // server-side against the order's actual payment state, never trusted
  // from this schema alone.
  refundMethod: cancellationRefundMethodEnum.optional(),
});
export type CancellationRequestInput = z.infer<typeof cancellationRequestInputSchema>;

export const adminCancellationDecisionInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional(),
});
export type AdminCancellationDecisionInput = z.infer<typeof adminCancellationDecisionInputSchema>;

// --- Return / refund (post-delivery) ----------------------------------------

export const refundMethodEnum = z.enum(["WALLET", "ORIGINAL_SOURCE", "BANK_TRANSFER"]);

// Standard IFSC shape: 4 letters (bank code), a literal 0, 6 alphanumeric
// (branch code) — e.g. SBIN0001234. Uppercased before validation so a
// customer typing lowercase isn't rejected.
const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code");

export const requestReturnInputSchema = z
  .object({
    sellerOrderId: z.string().min(1),
    orderItemId: z.string().min(1),
    reason: z.string().trim().min(3, "Enter a reason").max(500),
    // At least one photo is mandatory; the video is optional. Both are
    // uploaded (never a raw customer-typed URL) — the upload action
    // always returns a /api/uploads/... local path, which mediaUrlSchema
    // accepts alongside a real https:// URL.
    imageUrls: z.array(mediaUrlSchema).min(1, "Upload at least one photo").max(6),
    videoUrl: mediaUrlSchema.optional(),
    refundMethod: refundMethodEnum,
    bankAccountHolderName: z.string().trim().min(1).max(120).optional(),
    bankAccountNumber: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, "Enter a valid account number")
      .optional(),
    bankIfsc: ifscSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.refundMethod !== "BANK_TRANSFER") return;
    for (const [field, message] of [
      ["bankAccountHolderName", "Enter the account holder's name"],
      ["bankAccountNumber", "Enter a valid account number"],
      ["bankIfsc", "Enter the IFSC code"],
    ] as const) {
      if (!data[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
    }
  });
export type RequestReturnInput = z.infer<typeof requestReturnInputSchema>;

export const decideReturnRequestInputSchema = z
  .object({
    refundRequestId: z.string().min(1),
    approve: z.boolean(),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.approve && !data.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A rejection reason is required.",
        path: ["note"],
      });
    }
  });
export type DecideReturnRequestInput = z.infer<typeof decideReturnRequestInputSchema>;

/**
 * externalReference isn't validated as required here — whether it's needed
 * depends on the RefundRequest's own refundMethod (WALLET never needs one,
 * ORIGINAL_SOURCE/BANK_TRANSFER always do), which this schema has no way to
 * know without a DB lookup. completeRefund (packages/orders/src/refunds.ts)
 * is the actual authority, same convention as sendToRapidShypInputSchema
 * not knowing a seller's own RapidShyp config.
 */
export const completeRefundInputSchema = z.object({
  refundRequestId: z.string().min(1),
  externalReference: z.string().trim().max(200).optional(),
  /** POS orders let the operator pick the refund method at completion time instead of being locked to whatever it was created with — see completeRefund's own validation against the order's paymentMethod. */
  overrideRefundMethod: refundMethodEnum.optional(),
});
export type CompleteRefundInput = z.infer<typeof completeRefundInputSchema>;

// --- Admin manual status override ------------------------------------------

// Deliberately a plain string, not z.enum(OrderStatus values) — the actual
// gate is the transition service's allowed-from map (packages/orders), so
// an admin can never bypass it just by getting a value past this schema.
export const adminManualStatusUpdateInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  targetStatus: z.string().min(1),
  note: z.string().trim().max(300).optional(),
});
export type AdminManualStatusUpdateInput = z.infer<typeof adminManualStatusUpdateInputSchema>;

// --- Payment collection (COD / partial-payment remainder) ------------------

/**
 * `collectedAmount` is optional — omitted means "collect the full
 * outstanding balance," which is what the auto-complete-on-delivery path
 * always does. An admin using the manual action may supply a smaller
 * amount for a genuine cash shortfall; the service layer
 * (packages/orders/src/payment-collection.ts) is the actual authority on
 * the upper bound (never more than what's actually outstanding) — this
 * schema only rejects a non-positive value outright.
 */
export const recordPaymentCollectedInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  collectedAmount: moneySchema.positive("Enter an amount greater than zero").optional(),
});
export type RecordPaymentCollectedInput = z.infer<typeof recordPaymentCollectedInputSchema>;

// --- Seller pickup points ----------------------------------------------------

export const sellerPickupPointInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Enter a pickup point name").max(120),
  contactPerson: z.string().trim().min(1, "Enter a contact person").max(120),
  mobile: phoneSchema,
  line1: z.string().trim().min(1, "Enter the address").max(200),
  city: z.string().trim().min(1, "Enter the city").max(120),
  district: z.string().trim().min(1, "Enter the district").max(120),
  state: z.string().trim().min(1, "Enter the state").max(120),
  pincode: pincodeSchema,
  landmark: z.string().trim().max(120).optional(),
  isDefault: z.boolean().default(false),
});
export type SellerPickupPointInput = z.infer<typeof sellerPickupPointInputSchema>;
export type SellerPickupPointRawInput = z.input<typeof sellerPickupPointInputSchema>;

export const pickupPointDecisionInputSchema = z.object({
  pickupPointId: z.string().min(1),
  approve: z.boolean(),
  rejectionReason: z.string().trim().max(300).optional(),
});
export type PickupPointDecisionInput = z.infer<typeof pickupPointDecisionInputSchema>;

/**
 * Admin create/edit of a seller's pickup point (§K2 extended). Same body
 * fields as sellerPickupPointInputSchema plus `sellerId` (which seller the
 * point belongs to — only used on create; ignored on edit since a point's
 * owner never changes), an `isActive` toggle the admin gets directly, and
 * `approveNow` to skip straight past PENDING on create (runs the same
 * approval path as decidePickupPoint, Delhivery registration included).
 */
export const adminPickupPointInputSchema = sellerPickupPointInputSchema.extend({
  sellerId: z.string().min(1, "Select a seller"),
  isActive: z.boolean().default(true),
  approveNow: z.boolean().default(false),
});
export type AdminPickupPointInput = z.infer<typeof adminPickupPointInputSchema>;
export type AdminPickupPointRawInput = z.input<typeof adminPickupPointInputSchema>;

// --- Admin configuration ------------------------------------------------------

export const partialPaymentRuleTypeEnum = z.enum([
  "PERCENTAGE",
  "FIXED_AMOUNT",
  "MIN_ADVANCE_PERCENTAGE",
]);

export const partialPaymentConfigInputSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(120),
  appliesTo: z.enum(["CUSTOMER", "DEALER"]).optional(),
  ruleType: partialPaymentRuleTypeEnum,
  value: moneySchema,
  isActive: z.boolean().default(true),
  isDemo: z.boolean().default(true),
});
export type PartialPaymentConfigInput = z.infer<typeof partialPaymentConfigInputSchema>;

export const chargeCalcTypeEnum = z.enum(["FLAT", "PERCENTAGE"]);

export const collectionChargeConfigInputSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(120),
  chargeType: chargeCalcTypeEnum,
  value: moneySchema,
  minCharge: moneySchema.optional(),
  maxCharge: moneySchema.optional(),
  isActive: z.boolean().default(true),
});
export type CollectionChargeConfigInput = z.infer<typeof collectionChargeConfigInputSchema>;

// Business Settings — settlement tax rates (Commission/Logistics/Collection-
// Charge tax %). TCS/TDS are deliberately absent: fixed statutory rates
// (0.5% / 0.1%), never admin-editable — see
// packages/orders/src/settlement-rates.ts:FIXED_TCS_PERCENT/FIXED_TDS_PERCENT.
// This first admin-UI pass only edits the global config (sellerId/
// customerType both null) — the underlying service still supports
// per-seller/per-customerType overrides for a future UI pass.
const percentRateSchema = z.coerce.number().min(0).max(100);

export const settlementRateConfigInputSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(120),
  commissionGstPercent: percentRateSchema,
  logisticsGstPercent: percentRateSchema,
  collectionChargeGstPercent: percentRateSchema,
  isActive: z.boolean().default(true),
});
export type SettlementRateConfigInput = z.infer<typeof settlementRateConfigInputSchema>;

// --- POS payment-proof review ------------------------------------------

export const posPaymentProofDecisionSchema = z
  .object({
    submissionId: z.string().min(1),
    action: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.action === "REJECT" && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A rejection reason is required.",
        path: ["reason"],
      });
    }
  });
export type PosPaymentProofDecisionInput = z.infer<typeof posPaymentProofDecisionSchema>;
