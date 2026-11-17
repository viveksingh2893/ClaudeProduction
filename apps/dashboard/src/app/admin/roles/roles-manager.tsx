"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  FormInput,
  FormTextarea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
} from "@kisan4u/ui";
import { createRoleAction, deleteRoleAction } from "./actions";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  employeeCount: number;
};

export function RolesManager({ roles }: { roles: RoleRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createRoleAction({ name, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setDescription("");
      router.refresh();
    });
  }

  function handleDelete(role: RoleRow) {
    setError(null);
    startTransition(async () => {
      const result = await deleteRoleAction(role.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-bold text-ink">New role</h2>
        <div className="flex flex-wrap items-end gap-2">
          <FormInput
            label="Name"
            placeholder="e.g. Sales Agent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <FormTextarea
            label="Description"
            hint="Optional"
            placeholder="What is this role for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={1}
            className="max-w-sm"
          />
          <Button
            variant="primary"
            disabled={isPending || name.trim().length === 0}
            loading={isPending}
            onClick={handleCreate}
          >
            Create role
          </Button>
        </div>
        {error && (
          <div className="mt-2">
            <AlertBox tone="danger">{error}</AlertBox>
          </div>
        )}
      </Card>

      <TableShell>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Employees</TableHeaderCell>
              <TableHeaderCell>&nbsp;</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{role.name}</span>
                    {role.isSystem && <Badge tone="neutral">System</Badge>}
                  </div>
                  {role.description && (
                    <p className="mt-0.5 text-xs text-gray-500">{role.description}</p>
                  )}
                </TableCell>
                <TableCell>{role.employeeCount}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Link href={`/admin/roles/${role.id}`}>
                      <Button variant="outline" size="sm">
                        {role.isSystem ? "View permissions" : "Edit permissions"}
                      </Button>
                    </Link>
                    {!role.isSystem && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isPending || role.employeeCount > 0}
                        onClick={() => handleDelete(role)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>
    </div>
  );
}
