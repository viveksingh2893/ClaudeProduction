"use server";

import { revalidatePath } from "next/cache";
import { createEmployeeAccount, updateEmployeeAccount, setUserActive, adminResetPassword } from "@kisan4u/auth";
import type { EmployeeCreateInput, EmployeeUpdateInput, UserActiveToggleInput } from "@kisan4u/validators";
import { requireAdminPermission } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function createEmployeeAction(
  input: EmployeeCreateInput,
): Promise<Result & { temporaryPassword?: string }> {
  await requireAdminPermission("roles", "CREATE");
  const result = await createEmployeeAccount(input);
  if (!result.ok) return result;
  revalidatePath("/admin/employees");
  return { ok: true, temporaryPassword: result.temporaryPassword };
}

export async function updateEmployeeAction(input: EmployeeUpdateInput): Promise<Result> {
  await requireAdminPermission("roles", "EDIT");
  const result = await updateEmployeeAccount(input);
  if (result.ok) revalidatePath("/admin/employees");
  return result;
}

export async function toggleEmployeeActiveAction(input: UserActiveToggleInput): Promise<Result> {
  await requireAdminPermission("roles", "EDIT");
  const result = await setUserActive(input);
  if (result.ok) revalidatePath("/admin/employees");
  return result;
}

export async function resetEmployeePasswordAction(
  userId: string,
): Promise<Result & { temporaryPassword?: string }> {
  const session = await requireAdminPermission("roles", "EDIT");
  const result = await adminResetPassword(userId, { id: session.user.id, role: session.user.role });
  if (!result.ok) return result;
  return { ok: true, temporaryPassword: result.temporaryPassword };
}
