import { prisma, Prisma } from "@kisan4u/db";

const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

export async function reviewAccountDeletionRequest(input: {
  requestId: string;
  actorId: string;
  decision: "APPROVE" | "CANCEL";
}) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.accountDeletionRequest.findUnique({
      where: { id: input.requestId },
      include: { user: { select: { role: true, deletedAt: true } } },
    });
    if (!request || request.status !== "PENDING_REVIEW" || request.user.deletedAt) {
      return { ok: false as const, error: "This request is no longer pending review." };
    }
    const scheduledFor = input.decision === "APPROVE" ? new Date(Date.now() + GRACE_PERIOD_MS) : null;
    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: input.decision === "APPROVE" ? "SCHEDULED" : "CANCELLED",
        scheduledFor,
      },
    });
    await tx.user.update({
      where: { id: request.userId },
      data: {
        deletionRequestedAt: input.decision === "APPROVE" ? request.requestedAt : null,
        deletionScheduledFor: scheduledFor,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: "ADMIN",
        action: input.decision === "APPROVE" ? "ACCOUNT_DELETION_APPROVED" : "ACCOUNT_DELETION_CANCELLED_BY_ADMIN",
        entityType: "User",
        entityId: request.userId,
        metadata: { requestId: request.id, scheduledFor: scheduledFor?.toISOString() ?? null } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const };
  });
}
