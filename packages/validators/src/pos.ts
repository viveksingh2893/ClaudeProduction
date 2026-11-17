import { z } from "zod";
import { phoneSchema } from "./auth";
import { dealerRegistrationSchema } from "./registration";

/**
 * POS's own "Add New Customer" identity step (spec §6) — deliberately
 * narrower than the full account+address flow: this only creates the
 * User row. The address itself is added straight after via the existing
 * `customerAddressInputSchema` / `createAddress` (packages/orders/src/
 * address-book.ts), the same schema and function every other address form
 * in the app already uses — not a second, weaker address validator.
 */
export const posCreateCustomerSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(60),
  lastName: z.string().trim().min(1, "Enter a last name").max(60),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  phone: phoneSchema,
});
export type PosCreateCustomerInput = z.infer<typeof posCreateCustomerSchema>;

/**
 * POS's "Register New Dealer" (spec §8) reuses `dealerRegistrationSchema`
 * and shares its account-creation core with `registerDealer()`
 * (packages/auth/src/registration.ts's createDealerAccount) — same
 * PENDING-application, admin-approval-required outcome as the public
 * dealer signup flow, so a dealer registered from POS gets no special
 * fast-tracking. Two differences from the base schema: `phone` is added
 * (the public flow resolves it server-side from an OTP-verified
 * onboarding session — there is no such session in an admin-operated POS
 * flow — but the spec's own field list for this form omits a phone number
 * entirely even though DealerProfile.userId -> User.phone is required and
 * unique for a dealer to ever log in, so it's added here as a necessary,
 * minimal correction, not a spec deviation for its own sake); and the
 * single `name` field is replaced with `firstName`/`lastName`, matching
 * what the POS modal actually collects (two separate inputs) — so this
 * path never joins them into a string just to have registerPosDealer()
 * immediately re-split it apart again.
 */
export const posDealerRegistrationSchema = dealerRegistrationSchema
  .omit({ name: true })
  .extend({
    phone: phoneSchema,
    firstName: z.string().trim().min(1, "Enter a first name"),
    lastName: z.string().trim().min(1, "Enter a last name"),
  });
export type PosDealerRegistrationInput = z.infer<typeof posDealerRegistrationSchema>;
