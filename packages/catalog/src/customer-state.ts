import { prisma } from "@kisan4u/db";
import { writeAuditLog } from "./audit";
import { notifyUser } from "./licence-notifications";

export type CustomerStateResult = { ok: true } | { ok: false; error: string };

/**
 * Resolves the account-level catalogue-gating state for a signed-in
 * CUSTOMER — the single call site every customer-facing page/route should
 * use before calling getCustomerCatalogue/getPublicProductBySlug/
 * getCustomerProductById with a real `customerStateId`, so the
 * undefined-vs-null distinction in customerStateAvailabilityWhere is
 * applied consistently everywhere rather than each page re-deriving it.
 */
export async function resolveCustomerCatalogueStateId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stateId: true } });
  return user?.stateId ?? null;
}

async function findActiveState(stateId: string) {
  return prisma.indianState.findFirst({ where: { id: stateId, isActive: true } });
}

/**
 * Customer self-service, one-time-only state selection — spec: "The
 * customer may select their state only once." The lock is the presence of
 * a non-null `User.stateId` itself (no separate boolean flag): once set,
 * this function refuses to run again for the same user, regardless of
 * what a manually-modified request claims — this is the actual
 * enforcement boundary, not the UI disabling the button. Only ever
 * operates on `userId` taken from the caller's own authenticated session
 * (the Server Action must pass the session's own user id, never a
 * client-supplied target id) — see apps/web's customer account action.
 */
export async function setCustomerStateOnce(
  userId: string,
  stateId: string,
): Promise<CustomerStateResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, stateId: true },
  });
  if (!user || user.role !== "CUSTOMER") return { ok: false, error: "Customer account not found." };
  if (user.stateId) {
    return {
      ok: false,
      error: "Your state has already been set. Contact support to change it.",
    };
  }

  const state = await findActiveState(stateId);
  if (!state) return { ok: false, error: "Select a valid state." };

  await prisma.user.update({ where: { id: userId }, data: { stateId: state.id } });
  await writeAuditLog({
    actorId: userId,
    actorRole: "CUSTOMER",
    action: "CUSTOMER_STATE_SELECTED",
    entityType: "User",
    entityId: userId,
    metadata: { newStateId: state.id, newStateName: state.name },
  });

  return { ok: true };
}

/**
 * Admin-only state change — unlike the one-time self-service path above,
 * this is repeatable (an admin may need to correct a customer's state
 * more than once), always requires a reason, and always writes a full
 * before/after audit entry. Caller's Server Action must independently
 * verify the actor is an authorized admin (requireSession + module
 * permission check) before calling this — this function only checks that
 * the target is actually a customer and that the state is valid.
 */
export async function adminChangeCustomerState(
  targetUserId: string,
  newStateId: string,
  reason: string,
  actor: { id: string },
): Promise<CustomerStateResult> {
  if (!reason.trim()) return { ok: false, error: "A reason is required." };

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, stateId: true },
  });
  if (!user || user.role !== "CUSTOMER") return { ok: false, error: "Customer account not found." };

  const state = await findActiveState(newStateId);
  if (!state) return { ok: false, error: "Select a valid state." };

  if (user.stateId === state.id) {
    return { ok: false, error: "Customer is already assigned to this state." };
  }

  const oldStateId = user.stateId;
  const oldState = oldStateId
    ? await prisma.indianState.findUnique({ where: { id: oldStateId }, select: { name: true } })
    : null;

  await prisma.user.update({ where: { id: targetUserId }, data: { stateId: state.id } });
  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "CUSTOMER_STATE_CHANGED",
    entityType: "User",
    entityId: targetUserId,
    metadata: {
      oldStateId: oldStateId ?? null,
      oldStateName: oldState?.name ?? null,
      newStateId: state.id,
      newStateName: state.name,
    },
    reason,
  });
  await notifyUser({
    userId: targetUserId,
    title: "Your account state was updated",
    body: `An admin changed your selected state to "${state.name}". Reason: ${reason}`,
  });

  return { ok: true };
}
