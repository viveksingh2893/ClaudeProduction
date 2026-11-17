import { api, type ApiResult } from "@/lib/api-client";

export type DeletionBlocker = { code: string; message: string; count?: number };
export type DeletionStatus = {
  eligibility: {
    eligible: boolean;
    requiresManualReview: boolean;
    blockers: DeletionBlocker[];
    warnings: string[];
    walletBalance: number;
  };
  request: {
    id: string;
    status: "SCHEDULED" | "CANCELLED" | "COMPLETED" | "BLOCKED" | "PENDING_REVIEW";
    requestedAt: string;
    scheduledFor: string | null;
    completedAt: string | null;
  } | null;
};

export function getDeletionStatus(): Promise<ApiResult<DeletionStatus>> {
  return api.get("/api/mobile/v1/account/deletion");
}

export function sendDeletionOtp(): Promise<ApiResult<{ sent: true }>> {
  return api.post("/api/mobile/v1/account/deletion/otp");
}

export function confirmAccountDeletion(input: {
  code: string;
  reason?: string;
  immediate: boolean;
  forfeitWalletBalance: boolean;
}) {
  return api.post<{ completed: boolean }>("/api/mobile/v1/account/deletion", input);
}

export function restoreDeletedAccount(): Promise<ApiResult<{ restored: true }>> {
  return api.post("/api/mobile/v1/account/deletion/restore");
}
