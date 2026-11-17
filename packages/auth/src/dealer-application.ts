import { prisma, Prisma, UserRole, KycStatus, ApplicationStatus } from "@kisan4u/db";
import { stateNameFromGstNumber } from "@kisan4u/validators";
import type { DealerApplicationInput } from "@kisan4u/validators";
import { splitFullName } from "./name-split";

/**
 * The dealer-application fields as seen by this service. Licence number /
 * copy are optional here even though a NEW public application (validated
 * against dealerRegistrationSchema) requires them: the admin
 * "Convert to dealer" and "Edit dealer profile" paths validate against the
 * loosened adminConvertToDealerSchema / dealerProfileEditSchema, so a
 * legacy dealer with no licence on file can still be converted / edited.
 */
type DealerApplicationServiceInput = Omit<
  DealerApplicationInput,
  "licenseNumber" | "licenseDocUrl"
> & { licenseNumber?: string; licenseDocUrl?: string };

/**
 * "Customer becomes a dealer" — a customer keeps their `role: CUSTOMER`
 * account (orders, addresses, wallet, wishlist all intact) and gets a
 * `DealerProfile(status: PENDING)` attached to it. They keep signing in
 * and shopping as a customer until an admin approves, at which point
 * `setDealerApplicationStatus` (packages/auth/src/access.ts) flips both
 * `DealerProfile.status` → APPROVED and `User.role` → DEALER and bumps
 * `sessionVersion` so both clients re-auth as a dealer.
 *
 * A separate flow from `registerDealer` (packages/auth/src/registration.ts),
 * which is for a brand-new phone number with no account at all.
 */

type Result<T = undefined> =
  T extends undefined
    ? { ok: true } | { ok: false; error: string }
    : { ok: true; data: T } | { ok: false; error: string };

/**
 * GST number is the authoritative source of a dealer's state when present
 * — re-derived from scratch, never trusting a client-sent `stateId` that
 * disagrees with the GSTIN. Falls back to the picked `stateId` only when
 * no GST number was given. Same rule as createDealerAccount().
 */
async function resolveDealerState(
  gstNumber: string | undefined | null,
  stateId: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  if (gstNumber) {
    const derivedName = stateNameFromGstNumber(gstNumber);
    if (!derivedName) return { ok: false, error: "Enter a valid GST number." };
    const row = await prisma.indianState.findFirst({
      where: { name: derivedName, isActive: true },
      select: { id: true, name: true },
    });
    if (!row) return { ok: false, error: "We don't yet serve the state linked to this GST number." };
    return { ok: true, id: row.id, name: row.name };
  }
  const row = await prisma.indianState.findFirst({
    where: { id: stateId, isActive: true },
    select: { id: true, name: true },
  });
  if (!row) return { ok: false, error: "Select a valid state." };
  return { ok: true, id: row.id, name: row.name };
}

function toProfileFields(input: DealerApplicationServiceInput, state: { id: string; name: string }) {
  return {
    storeName: input.storeName,
    storeAddress: input.storeAddress,
    city: input.city,
    state: state.name,
    stateId: state.id,
    pincode: input.pincode,
    gstNumber: input.gstNumber || null,
    licenseNumber: input.licenseNumber || null,
    gstDocUrl: input.gstDocUrl || null,
    licenseDocUrl: input.licenseDocUrl || null,
  };
}

export type DealerApplicationView = {
  profileId: string;
  status: ApplicationStatus;
  kycStatus: KycStatus;
  rejectionReason: string | null;
  hasPendingChanges: boolean;
  /** The current profile field values — so the app / web / admin can pre-fill the "edit & resubmit" form. */
  form: {
    name: string;
    storeName: string;
    storeAddress: string;
    city: string;
    stateId: string;
    pincode: string;
    gstNumber: string;
    licenseNumber: string;
    gstDocUrl: string;
    licenseDocUrl: string;
  };
};

/** The current user's dealer-application status (any role) — drives the "Become a Dealer" / "Pending approval" / "Application rejected" button and pre-fills the form. Returns null when they've never applied. */
export async function getDealerApplicationForUser(
  userId: string,
): Promise<DealerApplicationView | null> {
  const profile = await prisma.dealerProfile.findUnique({
    where: { userId },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  if (!profile) return null;
  const name = [profile.user.firstName, profile.user.lastName].filter(Boolean).join(" ");
  return {
    profileId: profile.id,
    status: profile.status,
    kycStatus: profile.kycStatus,
    rejectionReason: profile.rejectionReason,
    hasPendingChanges: profile.pendingChanges != null,
    form: {
      name,
      storeName: profile.storeName ?? "",
      storeAddress: profile.storeAddress ?? "",
      city: profile.city ?? "",
      stateId: profile.stateId ?? "",
      pincode: profile.pincode ?? "",
      gstNumber: profile.gstNumber ?? "",
      licenseNumber: profile.licenseNumber ?? "",
      gstDocUrl: profile.gstDocUrl ?? "",
      licenseDocUrl: profile.licenseDocUrl ?? "",
    },
  };
}

/**
 * Create the PENDING application for an existing user (customer self-apply
 * or admin "Convert to dealer"), or update-and-resubmit a still-PENDING /
 * REJECTED one. Never touches `User.role`. Rejects if the user is already
 * an approved dealer or a suspended one.
 */
export async function submitDealerApplicationForUser(
  userId: string,
  rawInput: DealerApplicationServiceInput,
  parsedAlready?: DealerApplicationServiceInput,
): Promise<Result<{ profileId: string; resubmitted: boolean }>> {
  const input = parsedAlready ?? rawInput;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isGuest: true, isActive: true },
  });
  if (!user || !user.isActive) return { ok: false, error: "Account not found." };
  if (user.isGuest) {
    return { ok: false, error: "Verify your mobile number first, then apply to become a dealer." };
  }
  // Only an ordinary retail customer can apply. A DEALER already is one;
  // SELLER / ADMIN / STAFF / BUSINESS_ASSOCIATE / DELIVERY_MAN are staff-
  // side account types that must never be silently turned into a dealer.
  if (user.role !== UserRole.CUSTOMER) {
    return { ok: false, error: "This account type can't be converted to a dealer." };
  }

  const existing = await prisma.dealerProfile.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status === ApplicationStatus.APPROVED) {
      return { ok: false, error: "This account is already an approved dealer." };
    }
    if (existing.status === ApplicationStatus.SUSPENDED) {
      return { ok: false, error: "This dealer account is suspended. Please contact support." };
    }
  }

  const state = await resolveDealerState(input.gstNumber || null, input.stateId);
  if (!state.ok) return { ok: false, error: state.error };

  const { firstName, lastName } = splitFullName(input.name);
  const fields = toProfileFields(input, state);

  const profile = await prisma.$transaction(async (tx) => {
    // The application form re-collects the name — keep it in sync on the
    // user row too (same low-friction KYC-intake convention as OTP signup).
    await tx.user.update({ where: { id: userId }, data: { firstName, lastName } });

    if (existing) {
      return tx.dealerProfile.update({
        where: { id: existing.id },
        data: {
          ...fields,
          status: ApplicationStatus.PENDING,
          kycStatus: KycStatus.PENDING_REVIEW,
          rejectionReason: null,
          pendingChanges: Prisma.DbNull,
        },
        select: { id: true },
      });
    }
    return tx.dealerProfile.create({
      data: {
        userId,
        ...fields,
        status: ApplicationStatus.PENDING,
        kycStatus: KycStatus.PENDING_REVIEW,
      },
      select: { id: true },
    });
  });

  return { ok: true, data: { profileId: profile.id, resubmitted: Boolean(existing) } };
}

/**
 * Admin edits a dealer's business profile. For an APPROVED dealer the
 * change is parked in `pendingChanges` and needs a second
 * `approveDealerProfileChanges` — nothing live moves. For a
 * PENDING/REJECTED application it's applied in place (its own approval is
 * the gate). Either way, audited.
 */
export async function proposeDealerProfileChanges(
  profileId: string,
  rawInput: DealerApplicationServiceInput,
  actor: { id: string; role: UserRole },
): Promise<Result<{ mode: "parked" | "applied" }>> {
  const profile = await prisma.dealerProfile.findUnique({
    where: { id: profileId },
    select: { id: true, userId: true, status: true },
  });
  if (!profile) return { ok: false, error: "Dealer not found." };

  const state = await resolveDealerState(rawInput.gstNumber || null, rawInput.stateId);
  if (!state.ok) return { ok: false, error: state.error };
  const { firstName, lastName } = splitFullName(rawInput.name);
  const fields = toProfileFields(rawInput, state);

  if (profile.status === ApplicationStatus.APPROVED) {
    await prisma.$transaction([
      prisma.dealerProfile.update({
        where: { id: profileId },
        data: {
          pendingChanges: {
            ...fields,
            firstName,
            lastName,
            proposedByUserId: actor.id,
            proposedAt: new Date().toISOString(),
          },
        },
      }),
      prisma.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: "DEALER_PROFILE_EDIT_PROPOSED",
          entityType: "DealerProfile",
          entityId: profileId,
          metadata: { fields: { ...fields, firstName, lastName } },
        },
      }),
    ]);
    return { ok: true, data: { mode: "parked" } };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: profile.userId }, data: { firstName, lastName } }),
    prisma.dealerProfile.update({ where: { id: profileId }, data: fields }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: "DEALER_PROFILE_EDITED",
        entityType: "DealerProfile",
        entityId: profileId,
        metadata: { fields: { ...fields, firstName, lastName } },
      },
    }),
  ]);
  return { ok: true, data: { mode: "applied" } };
}

/** Merge a live dealer's parked `pendingChanges` into the real columns. */
export async function approveDealerProfileChanges(
  profileId: string,
  actor: { id: string; role: UserRole },
): Promise<Result> {
  const profile = await prisma.dealerProfile.findUnique({
    where: { id: profileId },
    select: { id: true, userId: true, pendingChanges: true, gstDocUrl: true, licenseDocUrl: true },
  });
  if (!profile) return { ok: false, error: "Dealer not found." };
  if (profile.pendingChanges == null) return { ok: false, error: "No pending changes to approve." };

  const p = profile.pendingChanges as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const strOrNull = (v: unknown): string | null | undefined =>
    typeof v === "string" ? v : v === null ? null : undefined;

  const firstName = str(p.firstName);
  const lastName = strOrNull(p.lastName);
  // Only the columns proposeDealerProfileChanges ever writes into pendingChanges.
  const fields = {
    storeName: str(p.storeName),
    storeAddress: str(p.storeAddress),
    city: str(p.city),
    state: str(p.state),
    stateId: str(p.stateId),
    pincode: str(p.pincode),
    gstNumber: strOrNull(p.gstNumber),
    licenseNumber: strOrNull(p.licenseNumber),
    gstDocUrl: strOrNull(p.gstDocUrl),
    licenseDocUrl: strOrNull(p.licenseDocUrl),
  };
  const cleanFields = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Record<string, string | null>;

  // Recompute the missing-documents flag from the state this approval
  // results in, not just what changed — ops may fix gstDocUrl and
  // licenseDocUrl in two separate edits, and the flag should only clear
  // once both are actually present. See DealerProfile.hasMissingDocuments.
  const finalGstDocUrl = cleanFields.gstDocUrl !== undefined ? cleanFields.gstDocUrl : profile.gstDocUrl;
  const finalLicenseDocUrl =
    cleanFields.licenseDocUrl !== undefined ? cleanFields.licenseDocUrl : profile.licenseDocUrl;
  const hasMissingDocuments = finalGstDocUrl == null || finalLicenseDocUrl == null;

  await prisma.$transaction([
    ...(firstName !== undefined || lastName !== undefined
      ? [
          prisma.user.update({
            where: { id: profile.userId },
            data: {
              ...(firstName !== undefined ? { firstName } : {}),
              ...(lastName !== undefined ? { lastName } : {}),
            },
          }),
        ]
      : []),
    prisma.dealerProfile.update({
      where: { id: profileId },
      data: { ...cleanFields, hasMissingDocuments, pendingChanges: Prisma.DbNull },
    }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: "DEALER_PROFILE_EDIT_APPROVED",
        entityType: "DealerProfile",
        entityId: profileId,
        metadata: { applied: cleanFields },
      },
    }),
  ]);
  return { ok: true };
}

/** Throw away a live dealer's parked `pendingChanges` without applying them. */
export async function discardDealerProfileChanges(
  profileId: string,
  actor: { id: string; role: UserRole },
): Promise<Result> {
  const profile = await prisma.dealerProfile.findUnique({
    where: { id: profileId },
    select: { id: true, pendingChanges: true },
  });
  if (!profile) return { ok: false, error: "Dealer not found." };
  if (profile.pendingChanges == null) return { ok: false, error: "No pending changes to discard." };

  await prisma.$transaction([
    prisma.dealerProfile.update({ where: { id: profileId }, data: { pendingChanges: Prisma.DbNull } }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: "DEALER_PROFILE_EDIT_DISCARDED",
        entityType: "DealerProfile",
        entityId: profileId,
      },
    }),
  ]);
  return { ok: true };
}
