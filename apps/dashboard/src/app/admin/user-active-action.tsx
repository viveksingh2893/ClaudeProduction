"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Power, PowerOff, Trash2 } from "lucide-react";
import { RowActionMenu, type RowAction } from "@kisan4u/ui";
import {
  deletionRequestHref,
  type ActiveDeletionStatus,
} from "@/components/admin/deletion-status-badge";
import { toggleUserActiveAction } from "./actions";
import { requestAdminAccountDeletionWithWalletConfirmation } from "./request-account-deletion";

/**
 * Shared Enable/Disable row action for the customer/dealer/seller tables —
 * toggles User.isActive directly (independent of DealerProfile/
 * SellerProfile.status, which ApplicationActions owns). A suspended
 * dealer/seller application and a disabled account are two different
 * axes; this only ever touches the account one.
 */
export function UserActiveAction({
  userId,
  userName,
  isActive,
  deletionStatus = null,
}: {
  userId: string;
  userName: string;
  isActive: boolean;
  deletionStatus?: ActiveDeletionStatus | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await toggleUserActiveAction({ userId, isActive: !isActive });
      router.refresh();
    });
  }

  function requestDeletion() {
    if (!window.confirm(`Schedule deletion for ${userName}? Eligibility checks will run first.`)) return;
    startTransition(async () => {
      const result = await requestAdminAccountDeletionWithWalletConfirmation(userId, userName);
      if (!result) return;
      if (!result.ok) window.alert(result.error);
      router.refresh();
    });
  }

  const actions: RowAction[] = [
    {
      label: isActive ? `Disable ${userName}'s account` : `Enable ${userName}'s account`,
      icon: isActive ? (
        <PowerOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Power className="h-4 w-4" aria-hidden="true" />
      ),
      tone: isActive ? "danger" : "default",
      onClick: toggle,
      disabled: isPending,
    },
    deletionStatus
      ? {
          label: "View deletion request",
          icon: <Eye className="h-4 w-4" aria-hidden="true" />,
          onClick: () => router.push(deletionRequestHref(deletionStatus)),
        }
      : {
          label: `Delete ${userName}'s account`,
          icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
          tone: "danger",
          onClick: requestDeletion,
          disabled: isPending,
        },
  ];

  return <RowActionMenu actions={actions} maxInline={2} />;
}
