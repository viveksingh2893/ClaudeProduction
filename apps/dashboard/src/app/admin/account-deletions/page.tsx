import type { AccountDeletionStatus } from "@kisan4u/db";
import { getFullName, prisma } from "@kisan4u/db";
import { Badge, Button, Card, PageContainer, PageHeader } from "@kisan4u/ui";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { requireAdminPermission } from "@/lib/session-guard";
import { ACCOUNT_DELETION_MODULE_KEY } from "@/lib/account-deletion-guard";
import { reviewDeletionAction } from "./actions";

const STATUSES: AccountDeletionStatus[] = [
  "PENDING_REVIEW",
  "SCHEDULED",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
];

const STATUS_LABEL: Record<AccountDeletionStatus, string> = {
  PENDING_REVIEW: "Pending review",
  SCHEDULED: "Scheduled",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function statusTone(status: AccountDeletionStatus) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "BLOCKED") return "danger" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "warning" as const;
}

function blockerMessages(snapshot: unknown): string[] {
  if (Array.isArray(snapshot)) {
    return snapshot.flatMap((item) => {
      if (
        item &&
        typeof item === "object" &&
        "message" in item &&
        typeof item.message === "string"
      ) {
        return [item.message];
      }
      return [];
    });
  }
  if (snapshot && typeof snapshot === "object" && "fileDeleteFailures" in snapshot) {
    const files = (snapshot as { fileDeleteFailures?: unknown }).fileDeleteFailures;
    if (Array.isArray(files) && files.length > 0) {
      return [
        `${files.length} stored file${files.length === 1 ? "" : "s"} still waiting for deletion retry.`,
      ];
    }
  }
  return [];
}

export default async function AccountDeletionRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminPermission(ACCOUNT_DELETION_MODULE_KEY, "VIEW");
  const params = await searchParams;
  const status = STATUSES.includes(params.status as AccountDeletionStatus)
    ? (params.status as AccountDeletionStatus)
    : "PENDING_REVIEW";

  const [requests, grouped] = await Promise.all([
    prisma.accountDeletionRequest.findMany({
      where: { status },
      orderBy: status === "PENDING_REVIEW" ? { requestedAt: "asc" } : { requestedAt: "desc" },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
            deletedAt: true,
          },
        },
      },
    }),
    prisma.accountDeletionRequest.groupBy({ by: ["status"], _count: true }),
  ]);

  const countByStatus = new Map(grouped.map((item) => [item.status, item._count]));
  const tabs: StatusTabItem[] = STATUSES.map((item) => ({
    key: item,
    label: STATUS_LABEL[item],
    count: countByStatus.get(item) ?? 0,
    href: `/admin/account-deletions?status=${item}`,
  }));

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Account deletion requests"
        description="Review pending requests and monitor scheduled, blocked, completed, and cancelled deletions."
      />
      <StatusTabs items={tabs} activeKey={status} />
      <div className="space-y-3">
        {requests.length === 0 ? (
          <Card className="p-5 text-sm text-gray-600">
            No {STATUS_LABEL[status].toLowerCase()} deletion requests.
          </Card>
        ) : (
          requests.map((request) => {
            const blockers = blockerMessages(request.blockersSnapshot);
            const accountName =
              getFullName(request.user) ??
              request.user.email ??
              request.user.phone ??
              (request.user.deletedAt ? "Deleted account" : "Account");
            return (
              <Card
                key={request.id}
                className="flex flex-wrap items-start justify-between gap-4 p-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-bold">{accountName}</div>
                    <Badge tone={statusTone(request.status)}>{STATUS_LABEL[request.status]}</Badge>
                  </div>
                  <div className="text-sm text-gray-600">
                    {request.user.role} ·{" "}
                    {request.source === "ADMIN" ? "Admin initiated" : "Self requested"} · requested{" "}
                    {request.requestedAt.toLocaleDateString("en-IN")}
                  </div>
                  {request.scheduledFor && (
                    <div className="text-sm font-semibold text-red-700">
                      Scheduled for {request.scheduledFor.toLocaleDateString("en-IN")}
                    </div>
                  )}
                  {request.completedAt && (
                    <div className="text-sm text-green-700">
                      Completed {request.completedAt.toLocaleDateString("en-IN")}
                    </div>
                  )}
                  {request.reason && <div className="text-sm">Reason: {request.reason}</div>}
                  {blockers.map((message) => (
                    <div key={message} className="text-sm font-semibold text-red-700">
                      {message}
                    </div>
                  ))}
                </div>
                {request.status === "PENDING_REVIEW" && (
                  <form action={reviewDeletionAction} className="flex gap-2">
                    <input type="hidden" name="requestId" value={request.id} />
                    <Button type="submit" name="decision" value="CANCEL" variant="outline">
                      Cancel request
                    </Button>
                    <Button type="submit" name="decision" value="APPROVE" variant="danger">
                      Approve deletion
                    </Button>
                  </form>
                )}
              </Card>
            );
          })
        )}
      </div>
    </PageContainer>
  );
}
