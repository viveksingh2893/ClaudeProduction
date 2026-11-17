import { prisma, Prisma, type UserRole } from "@kisan4u/db";

/**
 * Same shape and behavior as packages/orders/src/audit.ts's writeAuditLog
 * — duplicated rather than imported because packages/orders already
 * depends on packages/catalog (catalog -> orders would be a cycle). Both
 * write to the same generic AuditLog model with identical semantics, so a
 * caller in either package gets one consistent audit trail regardless of
 * which copy wrote the row.
 */
export async function writeAuditLog(entry: {
  actorId: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  reason?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      reason: entry.reason,
    },
  });
}
