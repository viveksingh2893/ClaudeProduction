import { prisma, Prisma, type UserRole } from "@kisan4u/db";

/**
 * Phase 4 spec §U — a single, reusable write path so every sensitive
 * operation (checkout creation, payment/order status change, seller
 * acceptance, pickup-point selection, cancellation, admin manual
 * intervention, charge recalculation) logs through one function instead of
 * each call site reinventing the shape. Never pass raw payment
 * credentials/secrets in `metadata` — only safe, structured facts.
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
