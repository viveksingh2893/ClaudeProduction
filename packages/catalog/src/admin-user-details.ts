import { prisma, Prisma } from "@kisan4u/db";
import { writeAuditLog } from "./audit";
import type {
  AdminUpdateUserDetailsInput,
  AdminUpdateDealerProfileInput,
  AdminUpdateSellerProfileInput,
} from "@kisan4u/validators";

export type AdminUserDetailsResult = { ok: true } | { ok: false; error: string };

/**
 * Admin edit of a customer/dealer's basic identity fields (name, phone,
 * email) — the account row's own contact details, previously read-only in
 * the admin panel. Phone and email are each unique across User, so a
 * collision surfaces as a friendly error instead of an unhandled 500.
 * Caller's Server Action must independently verify the actor is an
 * authorized admin before calling this.
 */
export async function adminUpdateUserDetails(
  input: AdminUpdateUserDetailsInput,
  actor: { id: string; role: "ADMIN" | "STAFF" },
): Promise<AdminUserDetailsResult> {
  const before = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });
  if (!before) return { ok: false, error: "Account not found." };

  try {
    await prisma.user.update({
      where: { id: input.userId },
      data: {
        firstName: input.firstName || null,
        lastName: input.lastName || null,
        email: input.email || null,
        phone: input.phone || null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.[0] ?? "value";
      return { ok: false, error: `That ${target} is already used by another account.` };
    }
    throw err;
  }

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "USER_DETAILS_UPDATED",
    entityType: "User",
    entityId: input.userId,
    metadata: {
      before,
      after: {
        firstName: input.firstName || null,
        lastName: input.lastName || null,
        email: input.email || null,
        phone: input.phone || null,
      },
    },
  });

  return { ok: true };
}

/**
 * Admin edit of a dealer's business/KYC-adjacent profile fields (store
 * name, GST, license number, store address) — deliberately excludes the
 * service state (stays on the Dealers list's existing "Change state"
 * flow) and the document uploads (re-upload isn't part of this form).
 */
export async function adminUpdateDealerProfile(
  input: AdminUpdateDealerProfileInput,
  actor: { id: string; role: "ADMIN" | "STAFF" },
): Promise<AdminUserDetailsResult> {
  const before = await prisma.dealerProfile.findUnique({
    where: { id: input.profileId },
    select: { storeName: true, gstNumber: true, licenseNumber: true, storeAddress: true, city: true, pincode: true },
  });
  if (!before) return { ok: false, error: "Dealer profile not found." };

  const after = {
    storeName: input.storeName || null,
    gstNumber: input.gstNumber || null,
    licenseNumber: input.licenseNumber || null,
    storeAddress: input.storeAddress || null,
    city: input.city || null,
    pincode: input.pincode || null,
  };

  await prisma.dealerProfile.update({ where: { id: input.profileId }, data: after });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "DEALER_PROFILE_UPDATED",
    entityType: "DealerProfile",
    entityId: input.profileId,
    metadata: { before, after },
  });

  return { ok: true };
}

/**
 * Admin edit of a seller's onboarding / business profile — the same
 * fields the "Become a Seller" application collects (company name,
 * contact person, website, registered address, states to sell in,
 * business contact email/mobile, GST number, PAN number, bank details),
 * minus the GST/PAN document uploads (view-only in the admin panel — the
 * files live on the storefront origin). The account's own login
 * name/email/phone are edited separately via adminUpdateUserDetails.
 * Caller's Server Action must verify the actor is an authorized admin.
 */
export async function adminUpdateSellerProfile(
  input: AdminUpdateSellerProfileInput,
  actor: { id: string; role: "ADMIN" | "STAFF" },
): Promise<AdminUserDetailsResult> {
  const before = await prisma.sellerProfile.findUnique({
    where: { id: input.profileId },
    select: {
      shopName: true,
      contactPersonName: true,
      companyWebsite: true,
      registeredAddress: true,
      contactEmail: true,
      contactMobile: true,
      gstNumber: true,
      panNumber: true,
      bankName: true,
      accountHolder: true,
      accountNumber: true,
      ifscCode: true,
      bankBranch: true,
      sellingStates: { select: { id: true } },
    },
  });
  if (!before) return { ok: false, error: "Seller profile not found." };

  // Only states that actually exist and are active — silently drop stale ids.
  const validStates = await prisma.indianState.findMany({
    where: { id: { in: input.sellingStateIds }, isActive: true },
    select: { id: true },
  });

  const after = {
    shopName: input.companyName,
    contactPersonName: input.contactPersonName || null,
    companyWebsite: input.companyWebsite || null,
    registeredAddress: input.registeredAddress || null,
    contactEmail: input.contactEmail || null,
    contactMobile: input.contactMobile || null,
    gstNumber: input.gstNumber || null,
    panNumber: input.panNumber || null,
    bankName: input.bankName || null,
    accountHolder: input.accountHolderName || null,
    accountNumber: input.accountNumber || null,
    ifscCode: input.ifscCode || null,
    bankBranch: input.bankBranch || null,
  };

  await prisma.sellerProfile.update({
    where: { id: input.profileId },
    data: {
      ...after,
      sellingStates: { set: validStates.map((s) => ({ id: s.id })) },
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "SELLER_PROFILE_UPDATED",
    entityType: "SellerProfile",
    entityId: input.profileId,
    metadata: {
      before: { ...before, sellingStates: before.sellingStates.map((s) => s.id) },
      after: { ...after, sellingStates: validStates.map((s) => s.id) },
    },
  });

  return { ok: true };
}
