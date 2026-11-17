"use server";

import {
  setDealerApplicationStatus,
  setSellerApplicationStatus,
  approveSellerApplication,
  setUserActive,
  submitDealerApplicationForUser,
  proposeDealerProfileChanges,
  approveDealerProfileChanges,
  discardDealerProfileChanges,
} from "@kisan4u/auth";
import {
  adminUpdateUserDetails,
  adminUpdateDealerProfile,
  adminUpdateSellerProfile,
  type AdminUserDetailsResult,
} from "@kisan4u/catalog";
import { adminCreditWallet, onReferredUserBecameDealer, requestAccountDeletion } from "@kisan4u/orders";
import { prisma } from "@kisan4u/db";
import { revalidatePath } from "next/cache";
import {
  adminUpdateUserDetailsSchema,
  adminUpdateDealerProfileSchema,
  adminUpdateSellerProfileSchema,
  adminWalletCreditInputSchema,
  adminConvertToDealerSchema,
  dealerProfileEditSchema,
  type ApplicationDecisionInput,
  type UserActiveToggleInput,
} from "@kisan4u/validators";
import { requireAdminPermission, requireSession } from "@/lib/session-guard";
import { ACCOUNT_DELETION_MODULE_KEY } from "@/lib/account-deletion-guard";

type ActionResult = { ok: true } | { ok: false; error: string };

export type AdminAccountDeletionActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      walletForfeitureConfirmationRequired?: boolean;
      walletBalance?: number;
    };

export async function requestAdminAccountDeletionAction(
  userId: string,
  forfeitWalletBalance = false,
): Promise<AdminAccountDeletionActionResult> {
  await requireAdminPermission(ACCOUNT_DELETION_MODULE_KEY, "DELETE");
  const result = await requestAccountDeletion({
    userId,
    source: "ADMIN",
    forfeitWalletBalance,
  });
  if (!result.ok) {
    if ("eligibility" in result) {
      const eligibility = result.eligibility;
      if (!eligibility) {
        return {
          ok: false,
          error: `Account deletion could not be scheduled: ${result.error}`,
        };
      }
      const { walletBalance, blockers } = eligibility;
      if (blockers.length > 0) {
        const walletNote =
          walletBalance > 0
            ? ` The account also has ₹${walletBalance.toFixed(2)} in its wallet; after these blockers are resolved, admin confirmation will be required before that balance is forfeited.`
            : "";
        return {
          ok: false,
          error: `Account deletion is blocked: ${blockers.map((blocker) => blocker.message).join(" ")}${walletNote}`,
        };
      }
      if (walletBalance > 0) {
        return {
          ok: false,
          error: `This account has ₹${walletBalance.toFixed(2)} in its wallet. Confirm that the user has been informed before scheduling deletion and forfeiture.`,
          walletForfeitureConfirmationRequired: true,
          walletBalance,
        };
      }
    }
    return { ok: false, error: `Account deletion could not be scheduled: ${result.error}` };
  }
  revalidatePath("/admin/customers");
  revalidatePath("/admin/dealers");
  revalidatePath("/admin/sellers");
  return { ok: true };
}

// requireSession(["ADMIN"]) re-verifies both the caller's role AND that
// their own session hasn't itself been revoked since it was issued —
// Server Actions can be invoked independent of which page rendered them,
// so the page-level check alone isn't enough (same "server-side, not
// only in middleware" principle applied to mutations, not just page
// reads). It redirects rather than returning an error on failure, which
// is correct here: a role/session failure isn't something the caller can
// recover from inline, it means "go log in again."

export async function decideDealerApplicationAction(
  input: ApplicationDecisionInput,
): Promise<ActionResult> {
  await requireSession(["ADMIN"]);
  const result = await setDealerApplicationStatus(input);
  if (result.ok) {
    // If this dealer was referred by a BA, credit the BA's dealer-approval
    // bonus (spec: on final approval only). No-op when there's no referrer.
    if (input.action === "APPROVE") {
      const profile = await prisma.dealerProfile.findUnique({
        where: { id: input.profileId },
        select: { userId: true },
      });
      if (profile) await onReferredUserBecameDealer(profile.userId).catch(() => {});
    }
    revalidatePath("/admin/dealers");
    revalidatePath(`/admin/dealers/${input.profileId}`);
    revalidatePath("/admin/customers");
  }
  return result;
}

/**
 * "Convert to dealer" from the customers table / a customer's detail page.
 * Attaches a PENDING DealerProfile to an existing customer account and
 * fills it from the dealer application form — the customer keeps their
 * CUSTOMER role and catalogue until an admin approves the application in
 * the Dealers list (packages/auth/src/dealer-application.ts). Re-running
 * it for a customer who already has a PENDING / REJECTED application just
 * updates that application in place.
 */
export async function adminConvertCustomerToDealerAction(
  rawInput: unknown,
): Promise<ActionResult> {
  await requireSession(["ADMIN"]);
  const parsed = adminConvertToDealerSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { userId, ...application } = parsed.data;
  const result = await submitDealerApplicationForUser(userId, application, application);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${userId}`);
  revalidatePath("/admin/dealers");
  return { ok: true };
}

/**
 * Admin edit of a dealer's business profile. "Every edit requires
 * confirmation and approval": for an APPROVED dealer this parks the new
 * values in DealerProfile.pendingChanges and returns `pending: true` —
 * nothing changes on the live account until approveDealerProfileChangesAction.
 * For a PENDING / REJECTED application it's applied straight away (the
 * application's own approval is the gate).
 */
export async function proposeDealerProfileChangesAction(
  rawInput: unknown,
): Promise<ActionResult & { pending?: boolean }> {
  const session = await requireSession(["ADMIN"]);
  const parsed = dealerProfileEditSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { profileId, ...fields } = parsed.data;
  const result = await proposeDealerProfileChanges(profileId, fields, {
    id: session.user.id,
    role: "ADMIN",
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/admin/dealers/${profileId}`);
  revalidatePath("/admin/dealers");
  return { ok: true, pending: result.data.mode === "parked" };
}

export async function approveDealerProfileChangesAction(
  profileId: string,
): Promise<ActionResult> {
  const session = await requireSession(["ADMIN"]);
  const result = await approveDealerProfileChanges(profileId, {
    id: session.user.id,
    role: "ADMIN",
  });
  if (result.ok) {
    revalidatePath(`/admin/dealers/${profileId}`);
    revalidatePath("/admin/dealers");
  }
  return result;
}

export async function discardDealerProfileChangesAction(
  profileId: string,
): Promise<ActionResult> {
  const session = await requireSession(["ADMIN"]);
  const result = await discardDealerProfileChanges(profileId, {
    id: session.user.id,
    role: "ADMIN",
  });
  if (result.ok) {
    revalidatePath(`/admin/dealers/${profileId}`);
    revalidatePath("/admin/dealers");
  }
  return result;
}

export async function decideSellerApplicationAction(
  input: ApplicationDecisionInput,
): Promise<ActionResult & { temporaryPassword?: string }> {
  const session = await requireSession(["ADMIN"]);
  // APPROVE also issues a first-login temporary password for a seller who
  // has none yet — returned here once so the admin can relay it.
  if (input.action === "APPROVE") {
    return approveSellerApplication(input.profileId, {
      id: session.user.id,
      role: "ADMIN",
    });
  }
  return setSellerApplicationStatus(input);
}

export async function toggleUserActiveAction(input: UserActiveToggleInput): Promise<ActionResult> {
  await requireSession(["ADMIN"]);
  return setUserActive(input);
}

/** Shared by the customer, dealer, and (via the dealer's own User row) seller detail pages — edits name/phone/email. */
export async function adminUpdateUserDetailsAction(
  rawInput: unknown,
): Promise<AdminUserDetailsResult> {
  const session = await requireSession(["ADMIN"]);
  const parsed = adminUpdateUserDetailsSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return adminUpdateUserDetails(parsed.data, { id: session.user.id, role: "ADMIN" });
}

/** Dealer-only business/KYC-adjacent fields (store name, GST, license, address) — the service state stays on the Dealers list's own "Change state" flow. */
export async function adminUpdateDealerProfileAction(
  rawInput: unknown,
): Promise<AdminUserDetailsResult> {
  const session = await requireSession(["ADMIN"]);
  const parsed = adminUpdateDealerProfileSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return adminUpdateDealerProfile(parsed.data, { id: session.user.id, role: "ADMIN" });
}

/** Seller onboarding / business fields (company name, contact person, website, registered address, states to sell in, GST number, bank details) — the GST/PAN documents are view-only. */
export async function adminUpdateSellerProfileAction(
  rawInput: unknown,
): Promise<AdminUserDetailsResult> {
  const session = await requireSession(["ADMIN"]);
  const parsed = adminUpdateSellerProfileSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return adminUpdateSellerProfile(parsed.data, { id: session.user.id, role: "ADMIN" });
}

/**
 * Manually add money to a customer's / dealer's Kisan4U Wallet from their
 * detail page — no payment gateway (goodwill credit, an offline payment
 * being recorded, a support adjustment). Writes an audited CREDIT ledger
 * row. `role` picks which wallet-owner type the credit is booked under.
 */
export async function adminCreditWalletAction(
  role: "CUSTOMER" | "DEALER",
  rawInput: unknown,
): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const session = await requireSession(["ADMIN"]);
  const parsed = adminWalletCreditInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await adminCreditWallet({
    userId: parsed.data.userId,
    role,
    amount: parsed.data.amount,
    note: parsed.data.note,
    actor: { id: session.user.id, role: "ADMIN" },
  });
  if (result.ok) {
    revalidatePath(`/admin/${role === "DEALER" ? "dealers" : "customers"}/${parsed.data.userId}`);
  }
  return result;
}
