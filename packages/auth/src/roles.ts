import bcrypt from "bcryptjs";
import { prisma, UserRole } from "@kisan4u/db";
import {
  roleCreateSchema,
  rolePermissionsUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  type RoleCreateInput,
  type RolePermissionsUpdateInput,
  type EmployeeCreateInput,
  type EmployeeUpdateInput,
} from "@kisan4u/validators";
import { BCRYPT_SALT_ROUNDS } from "./registration";
import { generateTemporaryPassword } from "./password-reset";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Every caller here (a Server Action) must independently verify the actor
 * holds the "roles" permission before calling any of these — same
 * convention as every other function in access.ts.
 */

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { adminProfiles: true, staffProfiles: true } },
    },
  });
}

export async function getRoleWithPermissions(roleId: string) {
  return prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });
}

export async function createRole(rawInput: RoleCreateInput): Promise<Result & { roleId?: string }> {
  const parsed = roleCreateSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await prisma.role.findUnique({ where: { name: parsed.data.name } });
  if (existing) return { ok: false, error: "A role with this name already exists." };

  const role = await prisma.role.create({
    data: { name: parsed.data.name, description: parsed.data.description || null },
  });
  return { ok: true, roleId: role.id };
}

/**
 * Replaces the full grant set for a role in one transaction — the caller
 * (the permission-matrix UI) always submits the complete desired state,
 * not a diff, so upserting each row and deleting anything not resubmitted
 * keeps the RolePermission table free of stale rows for a module/action
 * the admin unchecked.
 */
export async function updateRolePermissions(rawInput: RolePermissionsUpdateInput): Promise<Result> {
  const parsed = rolePermissionsUpdateSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { roleId, grants } = parsed.data;

  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { isSystem: true } });
  if (!role) return { ok: false, error: "Role not found." };
  if (role.isSystem) return { ok: false, error: "The Super Admin role's permissions can't be edited." };

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (grants.length > 0) {
      await tx.rolePermission.createMany({
        data: grants.map((g) => ({ roleId, module: g.module, action: g.action, granted: g.granted })),
      });
    }
  });
  return { ok: true };
}

export async function deleteRole(roleId: string): Promise<Result> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: {
      isSystem: true,
      _count: { select: { adminProfiles: true, staffProfiles: true } },
    },
  });
  if (!role) return { ok: false, error: "Role not found." };
  if (role.isSystem) return { ok: false, error: "The Super Admin role can't be deleted." };
  if (role._count.adminProfiles + role._count.staffProfiles > 0) {
    return { ok: false, error: "This role is still assigned to one or more accounts." };
  }

  await prisma.role.delete({ where: { id: roleId } });
  return { ok: true };
}

export async function listEmployees() {
  return prisma.user.findMany({
    where: { role: UserRole.STAFF },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      staffProfile: { select: { role: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateEmployeeResult =
  | { ok: true; userId: string; temporaryPassword: string }
  | { ok: false; error: string };

/**
 * Creates a STAFF User + StaffProfile in one transaction. Same login path
 * as a seller (email + password, apps/dashboard only, no OTP) — issues a
 * random temporary password and forces a change on first login, the exact
 * pattern adminResetPassword already uses. The plaintext password is
 * returned exactly once, to the admin who requested it.
 */
export async function createEmployeeAccount(rawInput: EmployeeCreateInput): Promise<CreateEmployeeResult> {
  const parsed = employeeCreateSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { firstName, lastName, roleId } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const phone = parsed.data.phone?.trim() || null;

  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true } });
  if (!role) return { ok: false, error: "Select a valid role." };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "An account with this email already exists." };
  if (phone) {
    const existingByPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingByPhone) return { ok: false, error: "An account with this phone number already exists." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
  const referralCode = `STF-${Date.now().toString(36).toUpperCase()}`;

  const user = await prisma.user.create({
    data: {
      email,
      phone,
      firstName,
      lastName,
      role: UserRole.STAFF,
      passwordHash,
      isEmailVerified: true,
      mustChangePassword: true,
      referralCode,
      staffProfile: { create: { roleId } },
    },
  });

  return { ok: true, userId: user.id, temporaryPassword };
}

/**
 * Edits an existing STAFF account's profile fields + role assignment.
 * Never touches password/isActive — those stay on resetEmployeePasswordAction
 * / toggleEmployeeActiveAction, same separation of concerns as the seller
 * profile edit modal.
 */
export async function updateEmployeeAccount(rawInput: EmployeeUpdateInput): Promise<Result> {
  const parsed = employeeUpdateSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { userId, firstName, lastName, roleId } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const phone = parsed.data.phone?.trim() || null;

  const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!existingUser || existingUser.role !== UserRole.STAFF) {
    return { ok: false, error: "Employee not found." };
  }

  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true } });
  if (!role) return { ok: false, error: "Select a valid role." };

  const emailOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (emailOwner && emailOwner.id !== userId) {
    return { ok: false, error: "An account with this email already exists." };
  }
  if (phone) {
    const phoneOwner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (phoneOwner && phoneOwner.id !== userId) {
      return { ok: false, error: "An account with this phone number already exists." };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      email,
      phone,
      staffProfile: { update: { roleId } },
    },
  });
  return { ok: true };
}
