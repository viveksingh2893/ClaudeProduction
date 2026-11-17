import bcrypt from "bcryptjs";
import { prisma, UserRole, KycStatus, getFullName } from "@kisan4u/db";
import {
  dealerRegistrationSchema,
  sellerRegistrationSchema,
  posDealerRegistrationSchema,
  stateNameFromGstNumber,
  posCreateCustomerSchema,
  maskIndianPhone,
  type DealerRegistrationInput,
  type SellerRegistrationInput,
  type PosDealerRegistrationInput,
  type PosCreateCustomerInput,
} from "@kisan4u/validators";
import { splitFullName } from "./name-split";
import { verifyPhoneVerificationToken } from "./phone-verification-token";

/**
 * bcrypt work factor for every password this app ever hashes for real
 * (non-seed) accounts — the single source of truth so a future call site
 * can't accidentally hash at a weaker cost. 12 rounds (~250-300ms on
 * typical server hardware) is the current OWASP-recommended floor; 10
 * (bcryptjs's own default, and what this project used previously) is
 * measurably weaker against offline GPU cracking of a leaked hash without
 * being meaningfully faster in practice for a login/registration request.
 * Never lower this without a specific reason — raising it later is safe
 * and doesn't invalidate existing hashes (bcrypt hashes are self-describing:
 * the cost factor is stored in the hash string itself, so old hashes at a
 * lower cost keep verifying correctly; only re-hashing on next successful
 * login would upgrade them, which isn't implemented here — see the
 * password-security report for why that's a deliberate follow-up, not done
 * automatically).
 */
export const BCRYPT_SALT_ROUNDS = 12;

export type RegistrationResult = { ok: true } | { ok: false; error: string };

export type DealerRegistrationResult =
  { ok: true; dealerProfileId: string } | { ok: false; error: string };

/**
 * Creates a new DEALER user + profile. `phone` is a TRUSTED parameter —
 * the caller (apps/web/src/app/register/dealer/details/actions.ts) must
 * have already resolved it server-side from an OTP-verified
 * DealerOnboardingSession (see packages/auth/src/onboarding.ts), never
 * from client-submitted form input. OTP verification itself already
 * happened at that earlier step, so it isn't repeated here.
 *
 * `stateId` is re-validated against the live, active IndianState table
 * regardless of what the registration form's dropdown showed — never
 * trusted as-is. The free-text `state` column (kept only for back-compat
 * display) is derived from the resolved state's own name, not from any
 * client input, so it can never disagree with `stateId`.
 *
 * No auto-login afterward via the normal NextAuth flow (the account
 * starts PENDING, and the dealer would normally log in separately via
 * /dealer/otp) — but the caller creates a short-lived
 * DealerStatusViewSession right after this returns `dealerProfileId`, so
 * the dealer can still land on /dealer/status immediately without a
 * fresh login (see packages/auth/src/onboarding.ts).
 */
/**
 * Shared core of dealer-account creation, factored out so both entry
 * points below (public web self-registration, which collects a single
 * "full name" field, and POS's Register New Dealer modal, which already
 * collects firstName/lastName as two separate inputs) can create the
 * User+DealerProfile row directly from a resolved firstName/lastName pair
 * — the POS path never round-trips through a concatenated name string.
 */
type DealerAccountInput = Omit<DealerRegistrationInput, "name"> & {
  firstName: string;
  lastName: string | null;
};

async function createDealerAccount(
  phone: string,
  input: DealerAccountInput,
): Promise<DealerRegistrationResult> {
  const {
    firstName,
    lastName,
    storeName,
    storeAddress,
    city,
    stateId,
    pincode,
    gstNumber,
    licenseNumber,
    gstDocUrl,
    licenseDocUrl,
  } = input;

  // When a GST number is supplied, it is the authoritative source of the
  // dealer's state — re-derived here from scratch rather than trusting
  // whatever `stateId` the client sent, so a tampered request (dropdown
  // re-enabled via devtools) can never register a state that disagrees
  // with the GSTIN. Only falls back to the client's own `stateId` pick
  // when no GST number was entered at all.
  let indianState;
  if (gstNumber) {
    const derivedStateName = stateNameFromGstNumber(gstNumber);
    if (!derivedStateName) {
      return { ok: false, error: "Enter a valid GST number." };
    }
    indianState = await prisma.indianState.findFirst({
      where: { name: derivedStateName, isActive: true },
    });
    if (!indianState) {
      return { ok: false, error: "We don't yet serve the state linked to this GST number." };
    }
  } else {
    indianState = await prisma.indianState.findFirst({ where: { id: stateId, isActive: true } });
    if (!indianState) {
      return { ok: false, error: "Select a valid state." };
    }
  }

  // Duplicate-prevention (requirement: no duplicate dealer profiles) —
  // the caller already checks this once at the verify step too, but a
  // second, authoritative check right before creating the row closes the
  // race window between "verify" and "submit" (two tabs, slow network,
  // etc.) with no cost beyond one extra query.
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return { ok: false, error: "This phone number is already registered." };
  }

  const referralCode = `DLR-${Date.now().toString(36).toUpperCase()}`;
  const user = await prisma.user.create({
    data: {
      phone,
      firstName,
      lastName,
      role: UserRole.DEALER,
      isPhoneVerified: true,
      referralCode,
      dealerProfile: {
        create: {
          storeName,
          storeAddress,
          city,
          state: indianState.name,
          stateId: indianState.id,
          pincode,
          gstNumber: gstNumber || null,
          licenseNumber: licenseNumber || null,
          gstDocUrl: gstDocUrl || null,
          licenseDocUrl: licenseDocUrl || null,
          kycStatus: KycStatus.PENDING_REVIEW,
          // status defaults to PENDING — an admin must approve before the
          // dealer can access protected pages, see packages/auth/src/access.ts
        },
      },
    },
    include: { dealerProfile: { select: { id: true } } },
  });

  return { ok: true, dealerProfileId: user.dealerProfile!.id };
}

/**
 * Public web self-registration entry point (apps/web/src/app/register/
 * dealer/details/actions.ts) — the form collects one "Full name" field
 * (low-friction KYC intake, same call as the OTP-signup name field), so
 * this is the one place that still splits a name string, using the same
 * first-space convention as the legacy-data backfill.
 *
 * `phone` is a TRUSTED parameter — the caller must have already resolved
 * it server-side from an OTP-verified DealerOnboardingSession (see
 * packages/auth/src/onboarding.ts), never from client-submitted form
 * input. OTP verification itself already happened at that earlier step,
 * so it isn't repeated here.
 */
export async function registerDealer(
  phone: string,
  rawInput: DealerRegistrationInput,
): Promise<DealerRegistrationResult> {
  const parsed = dealerRegistrationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, ...rest } = parsed.data;
  const { firstName, lastName } = splitFullName(name);
  return createDealerAccount(phone, { ...rest, firstName, lastName });
}

/**
 * POS's "Register New Dealer" (spec §8) entry point. Unlike the public
 * flow above, POS's modal already collects firstName/lastName as two
 * separate inputs — this takes them straight through with no
 * concatenate-then-resplit round trip through a single name string.
 */
export async function registerPosDealer(
  rawInput: PosDealerRegistrationInput,
): Promise<DealerRegistrationResult> {
  const parsed = posDealerRegistrationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { phone, ...rest } = parsed.data;
  return createDealerAccount(phone, rest);
}

/**
 * Creates a new SELLER user + profile from the public "Become a Seller"
 * application. NO password is set here — a seller cannot log in until an
 * admin approves them, at which point approveSellerApplication
 * (packages/auth/src/access.ts) issues a temporary password. The
 * passwordCredentialsProvider already returns null for a user with no
 * passwordHash, so a pending seller is locked out by construction.
 */
export async function registerSeller(
  rawInput: SellerRegistrationInput,
): Promise<RegistrationResult> {
  const parsed = sellerRegistrationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const { firstName, lastName } = splitFullName(d.contactPersonName);

  // The mobile number must have been OTP-verified in this same flow (the
  // token is issued by verifySellerApplyOtpAction only after a good code).
  const verifiedPhone = await verifyPhoneVerificationToken(d.phoneVerificationToken);
  if (verifiedPhone !== d.mobileNumber) {
    return {
      ok: false,
      error: "Your mobile number isn't verified. Please verify it with the OTP and try again.",
    };
  }

  const [byEmail, byPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email: d.email } }),
    prisma.user.findUnique({ where: { phone: d.mobileNumber } }),
  ]);
  if (byEmail) return { ok: false, error: "An account with this email already exists." };
  if (byPhone) return { ok: false, error: "An account with this mobile number already exists." };

  const slugBase = d.companyName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const slug = `${slugBase || "shop"}-${Date.now().toString(36)}`;
  const referralCode = `SLR-${Date.now().toString(36).toUpperCase()}`;

  // Composed single-line rendering kept for the admin seller-detail
  // display/edit, which still reads `registeredAddress`. The structured
  // columns below are the source of truth for a new application.
  const composedAddress = [
    d.registeredAddressLine1,
    d.registeredAddressLine2 || null,
    d.registeredCity,
    d.registeredDistrict,
    d.registeredState,
    d.registeredPincode,
  ]
    .filter(Boolean)
    .join(", ");

  await prisma.user.create({
    data: {
      email: d.email,
      phone: d.mobileNumber,
      firstName,
      lastName,
      role: UserRole.SELLER,
      // passwordHash intentionally omitted — set only on admin approval.
      isEmailVerified: true,
      isPhoneVerified: true, // OTP-verified above via phoneVerificationToken
      referralCode,
      sellerProfile: {
        create: {
          shopName: d.companyName,
          slug,
          contactPersonName: d.contactPersonName,
          companyWebsite: d.companyWebsite || null,
          registeredAddress: composedAddress,
          registeredAddressLine1: d.registeredAddressLine1,
          registeredAddressLine2: d.registeredAddressLine2 || null,
          registeredCity: d.registeredCity,
          registeredDistrict: d.registeredDistrict,
          registeredState: d.registeredState,
          registeredPincode: d.registeredPincode,
          gstNumber: d.gstNumber,
          gstDocUrl: d.gstDocUrl,
          panDocUrl: d.panDocUrl,
          bankName: d.bankName,
          accountHolder: d.accountHolderName,
          accountNumber: d.accountNumber,
          ifscCode: d.ifscCode,
          bankBranch: d.bankBranch,
          // Selling states are no longer collected on the apply form — an
          // admin sets them from the seller-detail page after approval.
          // status defaults to PENDING — an admin must approve before the
          // seller can access protected pages, see packages/auth/src/access.ts
        },
      },
    },
  });

  return { ok: true };
}

export type ExistingPosCustomer = {
  id: string;
  name: string;
  maskedPhone: string | null;
  email: string | null;
};
export type CreateCustomerForPosResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; existingCustomer?: ExistingPosCustomer };

/**
 * POS's "Add New Customer" (spec §6). Creates only the User row — the
 * caller (apps/dashboard's POS action) adds the first address right after
 * via the existing `createAddress` (packages/orders/src/address-book.ts),
 * same as every other place in the app that creates a customer address.
 *
 * Duplicate prevention checks BOTH phone and (when supplied) email against
 * the live table, same "second, authoritative check right before create"
 * principle as registerDealer above. On a match, returns the existing
 * customer (never silently creates a duplicate, never silently picks one)
 * so the caller can offer "select this customer instead" — see spec §6:
 * "If a matching customer exists, show the existing record and allow it
 * to be selected instead of creating a duplicate."
 */
export async function createCustomerForPos(
  rawInput: PosCreateCustomerInput,
): Promise<CreateCustomerForPosResult> {
  const parsed = posCreateCustomerSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { firstName, lastName, phone } = parsed.data;
  const email = parsed.data.email?.trim().toLowerCase() || null;

  const existingByPhone = await prisma.user.findUnique({ where: { phone } });
  if (existingByPhone) {
    if (existingByPhone.role !== UserRole.CUSTOMER) {
      return {
        ok: false,
        error: `This phone number is already registered as a ${existingByPhone.role.toLowerCase()} account.`,
      };
    }
    return {
      ok: false,
      error: "A customer with this phone number already exists.",
      existingCustomer: {
        id: existingByPhone.id,
        name: getFullName(existingByPhone) ?? existingByPhone.phone ?? "—",
        maskedPhone: existingByPhone.phone ? maskIndianPhone(existingByPhone.phone) : null,
        email: existingByPhone.email,
      },
    };
  }

  if (email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      if (existingByEmail.role !== UserRole.CUSTOMER) {
        return {
          ok: false,
          error: `This email is already registered as a ${existingByEmail.role.toLowerCase()} account.`,
        };
      }
      return {
        ok: false,
        error: "A customer with this email already exists.",
        existingCustomer: {
          id: existingByEmail.id,
          name: getFullName(existingByEmail) ?? existingByEmail.phone ?? "—",
          maskedPhone: existingByEmail.phone ? maskIndianPhone(existingByEmail.phone) : null,
          email: existingByEmail.email,
        },
      };
    }
  }

  const referralCode = `CUS-${Date.now().toString(36).toUpperCase()}`;
  const user = await prisma.user.create({
    data: {
      phone,
      email,
      firstName,
      lastName,
      role: UserRole.CUSTOMER,
      // Neither channel is actually verified here — the admin entered
      // these on the customer's behalf at the counter, no OTP/email link
      // was sent. This doesn't block login: OTP sign-in re-verifies the
      // phone at that point regardless of this flag (see otp-login.ts).
      isPhoneVerified: false,
      isEmailVerified: false,
      referralCode,
    },
  });

  return { ok: true, userId: user.id };
}
