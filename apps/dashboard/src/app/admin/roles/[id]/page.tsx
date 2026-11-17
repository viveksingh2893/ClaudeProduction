import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRoleWithPermissions } from "@kisan4u/auth";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireAdminPermission } from "@/lib/session-guard";
import { PermissionMatrix } from "./permission-matrix";

// Every module key this RBAC slice knows about — kept in sync with
// apps/dashboard/src/app/admin/layout.tsx's MODULE_BY_HREF and the seed/
// backfill script's KNOWN_MODULES. A module gets real route-level
// enforcement only once its pages actually call requireAdminPermission();
// this list is what a role's permissions can be *set* to regardless.
const KNOWN_MODULES = [
  { key: "pos", label: "POS" },
  { key: "payment-verification", label: "Payment verification" },
  { key: "order-scheduling", label: "Order scheduling" },
  { key: "settlements", label: "Settlement cycles" },
  { key: "roles", label: "Roles & employees" },
  { key: "account-deletions", label: "Account deletions" },
] as const;
const ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE"] as const;

export default async function AdminRoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPermission("roles", "VIEW");
  const { id } = await params;
  const role = await getRoleWithPermissions(id);
  if (!role) redirect("/admin/roles");

  const grants = new Set(
    role.permissions.filter((p) => p.granted).map((p) => `${p.module}:${p.action}`),
  );

  return (
    <PageContainer className="py-8" maxWidth="700px">
      <Link
        href="/admin/roles"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-green-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All roles
      </Link>
      <PageHeader
        title={role.name}
        description={
          role.isSystem
            ? "This is the built-in Super Admin role — it always has every permission and can't be edited."
            : "Choose exactly what this role can do, per module."
        }
      />
      <PermissionMatrix
        roleId={role.id}
        readOnly={role.isSystem}
        modules={KNOWN_MODULES}
        actions={ACTIONS}
        initialGrants={Array.from(grants)}
      />
    </PageContainer>
  );
}
