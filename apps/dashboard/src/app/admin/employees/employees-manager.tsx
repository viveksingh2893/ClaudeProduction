"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActiveBadge,
  AlertBox,
  Button,
  Card,
  FormInput,
  FormSelect,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
} from "@kisan4u/ui";
import {
  createEmployeeAction,
  updateEmployeeAction,
  toggleEmployeeActiveAction,
  resetEmployeePasswordAction,
} from "./actions";

export type EmployeeRow = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  roleId: string;
  roleName: string;
};

export function EmployeesManager({
  employees,
  roles,
}: {
  employees: EmployeeRow[];
  roles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRoleId, setEditRoleId] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createEmployeeAction({
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        roleId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      if (result.temporaryPassword) setRevealedPassword(result.temporaryPassword);
      router.refresh();
    });
  }

  function handleToggleActive(employee: EmployeeRow) {
    setError(null);
    startTransition(async () => {
      const result = await toggleEmployeeActiveAction({
        userId: employee.id,
        isActive: !employee.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleOpenEdit(employee: EmployeeRow) {
    setEditError(null);
    setEditing(employee);
    setEditFirstName(employee.firstName);
    setEditLastName(employee.lastName);
    setEditEmail(employee.email ?? "");
    setEditPhone(employee.phone ?? "");
    setEditRoleId(employee.roleId);
  }

  function handleSaveEdit() {
    if (!editing) return;
    setEditError(null);
    startEditTransition(async () => {
      const result = await updateEmployeeAction({
        userId: editing.id,
        firstName: editFirstName,
        lastName: editLastName,
        email: editEmail,
        phone: editPhone || undefined,
        roleId: editRoleId,
      });
      if (!result.ok) {
        setEditError(result.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function handleResetPassword(employee: EmployeeRow) {
    setError(null);
    startTransition(async () => {
      const result = await resetEmployeePasswordAction(employee.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.temporaryPassword) setRevealedPassword(result.temporaryPassword);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-bold text-ink">New employee</h2>
        {roles.length === 0 ? (
          <AlertBox tone="warning">Create a role first, on the Roles page.</AlertBox>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <FormInput
              label="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="max-w-[160px]"
            />
            <FormInput
              label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="max-w-[160px]"
            />
            <FormInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-[220px]"
            />
            <FormInput
              label="Phone"
              hint="Optional"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="max-w-[160px]"
            />
            <FormSelect
              label="Role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="max-w-[180px]"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </FormSelect>
            <Button
              variant="primary"
              disabled={
                isPending || !firstName.trim() || !lastName.trim() || !email.trim() || !roleId
              }
              loading={isPending}
              onClick={handleCreate}
            >
              Create employee
            </Button>
          </div>
        )}
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
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Contact</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Active</TableHeaderCell>
              <TableHeaderCell>&nbsp;</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {employees.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell>
                  <span className="font-semibold text-ink">{employee.name}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-600">{employee.email ?? employee.phone ?? "—"}</span>
                </TableCell>
                <TableCell>{employee.roleName}</TableCell>
                <TableCell>
                  <ActiveBadge active={employee.isActive} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleOpenEdit(employee)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleResetPassword(employee)}
                    >
                      Reset password
                    </Button>
                    <Button
                      variant={employee.isActive ? "danger" : "primary"}
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleToggleActive(employee)}
                    >
                      {employee.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>

      <Modal
        open={revealedPassword !== null}
        onClose={() => setRevealedPassword(null)}
        title="Temporary password"
      >
        <p className="mb-3 text-sm text-gray-600">
          Share this with the employee — it's shown only once and must be changed on their first
          login.
        </p>
        <code className="block rounded-md bg-bg-dashboard px-3 py-2.5 text-sm font-bold text-ink">
          {revealedPassword}
        </code>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => setRevealedPassword(null)}>
            Done
          </Button>
        </div>
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit employee">
        <div className="flex flex-col gap-3">
          <FormInput
            label="First name"
            value={editFirstName}
            onChange={(e) => setEditFirstName(e.target.value)}
          />
          <FormInput
            label="Last name"
            value={editLastName}
            onChange={(e) => setEditLastName(e.target.value)}
          />
          <FormInput
            label="Email"
            type="email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
          />
          <FormInput
            label="Phone"
            hint="Optional"
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
          />
          <FormSelect label="Role" value={editRoleId} onChange={(e) => setEditRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </FormSelect>
          {editError && <AlertBox tone="danger">{editError}</AlertBox>}
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)} disabled={isEditPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveEdit}
              loading={isEditPending}
              disabled={
                isEditPending || !editFirstName.trim() || !editLastName.trim() || !editEmail.trim() || !editRoleId
              }
            >
              Save changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
