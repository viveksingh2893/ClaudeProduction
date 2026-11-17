import { prisma } from "@kisan4u/db";

export type PermissionAction = "VIEW" | "CREATE" | "EDIT" | "DELETE";

/**
 * A user's Role assignment lives on exactly one of AdminProfile/StaffProfile
 * (a person is either a full admin account or a restricted employee
 * account, never both) — this is the one place both account types converge
 * onto the same Role/RolePermission table.
 */
async function resolveRoleId(userId: string): Promise<string | null> {
  const [adminProfile, staffProfile] = await Promise.all([
    prisma.adminProfile.findUnique({ where: { userId }, select: { roleId: true } }),
    prisma.staffProfile.findUnique({ where: { userId }, select: { roleId: true } }),
  ]);
  return adminProfile?.roleId ?? staffProfile?.roleId ?? null;
}

/**
 * Fail-CLOSED: no Role assigned, or no explicit granted:true RolePermission
 * row for (module, action), means denied. This is the opposite default of
 * the legacy hasModulePermission (packages/auth/src/access.ts), which fails
 * open — safe here only because every existing ADMIN account is backfilled
 * with an explicit "Super Admin" role carrying every permission BEFORE this
 * function is ever wired into a real route (see the seed/backfill script).
 *
 * Deliberately a live DB read every time, never cached on the JWT — same
 * convention access.ts's hasModulePermission already documents ("session
 * only carries id/role/firstName/lastName, not permissions"), so a role's
 * permissions take effect immediately without needing a token-invalidation
 * mechanism.
 */
export async function hasPermission(
  userId: string,
  module: string,
  action: PermissionAction = "VIEW",
): Promise<boolean> {
  const roleId = await resolveRoleId(userId);
  if (!roleId) return false;

  const permission = await prisma.rolePermission.findUnique({
    where: { roleId_module_action: { roleId, module, action } },
    select: { granted: true },
  });
  return permission?.granted === true;
}
