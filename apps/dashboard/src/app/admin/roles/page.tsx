import { listRoles } from "@kisan4u/auth";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireAdminPermission } from "@/lib/session-guard";
import { RolesManager } from "./roles-manager";

export default async function AdminRolesPage() {
  await requireAdminPermission("roles", "VIEW");
  const roles = await listRoles();

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <PageHeader
        title="Roles"
        description="Create roles and choose exactly what each one can do — then assign them to employee accounts from Employees."
      />
      <RolesManager
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isSystem: r.isSystem,
          employeeCount: r._count.adminProfiles + r._count.staffProfiles,
        }))}
      />
    </PageContainer>
  );
}
