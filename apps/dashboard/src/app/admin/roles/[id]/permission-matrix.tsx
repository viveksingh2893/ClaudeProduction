"use client";

import { useState, useTransition } from "react";
import { AlertBox, Button, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableShell } from "@kisan4u/ui";
import type { PermissionAction } from "@kisan4u/auth";
import { updateRolePermissionsAction } from "../actions";

export function PermissionMatrix({
  roleId,
  readOnly,
  modules,
  actions,
  initialGrants,
}: {
  roleId: string;
  readOnly: boolean;
  modules: readonly { key: string; label: string }[];
  actions: readonly string[];
  initialGrants: string[];
}) {
  const [grants, setGrants] = useState<Set<string>>(new Set(initialGrants));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggle(moduleKey: string, action: string) {
    if (readOnly) return;
    setSaved(false);
    const cell = `${moduleKey}:${action}`;
    setGrants((prev) => {
      const next = new Set(prev);
      if (next.has(cell)) next.delete(cell);
      else next.add(cell);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateRolePermissionsAction({
        roleId,
        grants: Array.from(grants).map((cell) => {
          const [module, action] = cell.split(":");
          return { module: module!, action: action as PermissionAction, granted: true };
        }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <TableShell>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Module</TableHeaderCell>
              {actions.map((action) => (
                <TableHeaderCell key={action}>{action}</TableHeaderCell>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            {modules.map((mod) => (
              <TableRow key={mod.key}>
                <TableCell>
                  <span className="font-semibold text-ink">{mod.label}</span>
                </TableCell>
                {actions.map((action) => (
                  <TableCell key={action}>
                    <input
                      type="checkbox"
                      checked={grants.has(`${mod.key}:${action}`)}
                      onChange={() => toggle(mod.key, action)}
                      disabled={readOnly}
                      className="h-4 w-4 accent-green-600 disabled:cursor-not-allowed"
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={isPending} loading={isPending} onClick={handleSave}>
            Save permissions
          </Button>
          {saved && <span className="text-xs font-semibold text-success">Saved.</span>}
        </div>
      )}
      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
