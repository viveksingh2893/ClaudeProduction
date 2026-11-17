"use client";

import {
  requestAdminAccountDeletionAction,
  type AdminAccountDeletionActionResult,
} from "./actions";

export async function requestAdminAccountDeletionWithWalletConfirmation(
  userId: string,
  userName: string,
): Promise<AdminAccountDeletionActionResult | null> {
  const result = await requestAdminAccountDeletionAction(userId);
  if (
    result.ok ||
    !result.walletForfeitureConfirmationRequired ||
    result.walletBalance === undefined
  ) {
    return result;
  }

  const confirmed = window.confirm(
    `${userName}'s wallet contains ₹${result.walletBalance.toFixed(2)}. Confirm that the user has been informed that this balance will be permanently forfeited immediately when deletion is scheduled and will not be returned if the account is restored. Schedule deletion?`,
  );
  if (!confirmed) return null;

  return requestAdminAccountDeletionAction(userId, true);
}
