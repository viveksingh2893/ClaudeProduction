import { listEmployees, listRoles } from "@kisan4u/auth";
import { getFullName } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireAdminPermission } from "@/lib/session-guard";
import { EmployeesManager } from "./employees-manager";

export default async function AdminEmployeesPage() {
  await requireAdminPermission("roles", "VIEW");
  const [employees, roles] = await Promise.all([listEmployees(), listRoles()]);

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <PageHeader
        title="Employees"
        description="Create employee accounts and assign them a role — see Roles to define what each role can do."
      />
      <EmployeesManager
        employees={employees.map((e) => ({
          id: e.id,
          name: getFullName(e) ?? e.email ?? e.phone ?? "—",
          firstName: e.firstName ?? "",
          lastName: e.lastName ?? "",
          email: e.email,
          phone: e.phone,
          isActive: e.isActive,
          roleId: e.staffProfile?.role.id ?? "",
          roleName: e.staffProfile?.role.name ?? "—",
        }))}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
      />
    </PageContainer>
  );
}
