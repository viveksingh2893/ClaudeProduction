"use server";

import { revalidatePath } from "next/cache";
import { createRole, updateRolePermissions, deleteRole } from "@kisan4u/auth";
import type { RoleCreateInput, RolePermissionsUpdateInput } from "@kisan4u/validators";
import { requireAdminPermission } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function createRoleAction(
  input: RoleCreateInput,
): Promise<Result & { roleId?: string }> {
  await requireAdminPermission("roles", "CREATE");
  const result = await createRole(input);
  if (result.ok) revalidatePath("/admin/roles");
  return result;
}

export async function updateRolePermissionsAction(
  input: RolePermissionsUpdateInput,
): Promise<Result> {
  await requireAdminPermission("roles", "EDIT");
  const result = await updateRolePermissions(input);
  if (result.ok) {
    revalidatePath("/admin/roles");
    revalidatePath(`/admin/roles/${input.roleId}`);
  }
  return result;
}

export async function deleteRoleAction(roleId: string): Promise<Result> {
  await requireAdminPermission("roles", "DELETE");
  const result = await deleteRole(roleId);
  if (result.ok) revalidatePath("/admin/roles");
  return result;
}
