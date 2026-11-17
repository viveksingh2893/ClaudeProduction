import { z } from "zod";
import { phoneSchema, normalizeIndianPhone } from "./phone";

/**
 * Indian PIN codes are 6 digits and never start with 0 — kept as a
 * standalone schema (not folded into phoneSchema-style normalization)
 * since a PIN code has no alternate input shapes to normalize away.
 */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit Indian PIN code");

/**
 * Same normalization as phoneSchema, but optional — for the alternate
 * mobile field only. `.nullish()` (not just `.optional()`) because
 * AddressDTO types this `string | null` to mirror the DB column, and
 * JSON.stringify preserves `null` (unlike `undefined`, which it drops) —
 * a client sending the DTO's own shape back on create/update must not
 * be rejected for it.
 */
const optionalMobileSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const normalized = normalizeIndianPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid 10-digit Indian mobile number.",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const addressKindEnum = z.enum(["HOME", "FARM", "SHOP", "OFFICE", "OTHER"]);

/**
 * `id` present = update an existing address, absent = create a new one
 * (matches the convention documented on productVariantInputSchema in
 * catalog.ts). `stateId` is accepted from the client only as a
 * convenience pointer to IndianState — the server always re-resolves and
 * re-validates it, and for a dealer, checkout re-derives the state from
 * DealerProfile rather than trusting this field at all (see Phase 4 spec
 * §C2 — a dealer must never bypass their verified state via a new
 * address).
 */
export const customerAddressInputSchema = z.object({
  id: z.string().min(1).optional(),
  fullName: z.string().trim().min(1, "Enter the recipient's full name").max(120),
  mobile: phoneSchema,
  altMobile: optionalMobileSchema,
  line1: z.string().trim().min(1, "Enter the address").max(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  cityTown: z.string().trim().min(1, "Enter the village, town or city").max(120),
  district: z.string().trim().min(1, "Enter the district").max(120),
  state: z.string().trim().min(1, "Select a state").max(120),
  stateId: z.string().min(1).nullish(),
  pincode: pincodeSchema,
  addressType: addressKindEnum.default("HOME"),
  isDefault: z.boolean().default(false),
});

export type CustomerAddressInput = z.infer<typeof customerAddressInputSchema>;
export type CustomerAddressRawInput = z.input<typeof customerAddressInputSchema>;

/**
 * Admin correction to an already-placed order's delivery address
 * (OrderAddressSnapshot) — used from the Create Shipment wizard when the
 * scheduling team catches a wrong address while confirming/dispatching.
 * Same field set as customerAddressInputSchema minus `id`/`isDefault`
 * (an OrderAddressSnapshot has neither concept), plus `sellerOrderId` to
 * identify which order's checkout group to update.
 */
export const orderAddressUpdateInputSchema = z.object({
  sellerOrderId: z.string().min(1),
  fullName: z.string().trim().min(1, "Enter the recipient's full name").max(120),
  mobile: phoneSchema,
  altMobile: optionalMobileSchema,
  line1: z.string().trim().min(1, "Enter the address").max(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  cityTown: z.string().trim().min(1, "Enter the village, town or city").max(120),
  district: z.string().trim().min(1, "Enter the district").max(120),
  state: z.string().trim().min(1, "Select a state").max(120),
  stateId: z.string().min(1).nullish(),
  pincode: pincodeSchema,
  addressType: addressKindEnum.default("HOME"),
});

export type OrderAddressUpdateInput = z.infer<typeof orderAddressUpdateInputSchema>;
export type OrderAddressUpdateRawInput = z.input<typeof orderAddressUpdateInputSchema>;
