import { Badge } from "@kisan4u/ui";

export type ActiveDeletionStatus = "PENDING_REVIEW" | "SCHEDULED" | "BLOCKED";

export function toActiveDeletionStatus(status: string | null | undefined): ActiveDeletionStatus | null {
  return status === "PENDING_REVIEW" || status === "SCHEDULED" || status === "BLOCKED"
    ? status
    : null;
}

export function deletionRequestHref(status: ActiveDeletionStatus) {
  return `/admin/account-deletions?status=${status}`;
}

export function DeletionStatusBadge({
  requestedAt,
  scheduledFor,
}: {
  requestedAt: Date | string | null;
  scheduledFor: Date | string | null;
}) {
  if (!requestedAt) return null;
  const scheduled = scheduledFor ? new Date(scheduledFor) : null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone="danger">{scheduled ? "Deletion pending" : "Deletion review"}</Badge>
      <span className="text-[11px] text-red-700">
        {scheduled ? `Scheduled ${scheduled.toLocaleDateString("en-IN")}` : "Awaiting admin review"}
      </span>
    </div>
  );
}
