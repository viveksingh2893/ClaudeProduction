"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Copy, Trash2, FileSpreadsheet } from "lucide-react";
import { AlertBox, Button, Card, formatDateTimeDDMMYYYY } from "@kisan4u/ui";

type DraftSummary = {
  id: string;
  name: string;
  status: string;
  groupCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type Result = { ok: true; data?: { id: string } } | { ok: false; error: string };

export function DraftListManager({
  drafts,
  basePath,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: {
  drafts: DraftSummary[];
  basePath: string;
  onCreate: (name: string) => Promise<Result>;
  onRename: (draftId: string, name: string) => Promise<Result>;
  onDuplicate: (draftId: string) => Promise<Result>;
  onDelete: (draftId: string) => Promise<Result>;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onCreate(newName || "Untitled draft");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data) router.push(`${basePath}/${result.data.id}`);
    });
  }

  function handleRename(draftId: string) {
    startTransition(async () => {
      const result = await onRename(draftId, renameValue);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRenamingId(null);
      router.refresh();
    });
  }

  function handleDuplicate(draftId: string) {
    startTransition(async () => {
      const result = await onDuplicate(draftId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(draftId: string) {
    if (!window.confirm("Delete this draft permanently? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await onDelete(draftId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleCreate} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-600">Draft name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Spring 2026 restock"
              className="w-full rounded-md border-[1.5px] border-border px-3 py-2.5 text-sm outline-none focus:border-green-600"
            />
          </div>
          <Button type="submit" loading={isPending}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New draft
          </Button>
        </form>
        {error && (
          <div className="mt-3">
            <AlertBox tone="danger">{error}</AlertBox>
          </div>
        )}
      </Card>

      {drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center text-sm text-gray-500">
          <FileSpreadsheet className="h-8 w-8 text-gray-300" aria-hidden="true" />
          No drafts yet — create one above to start entering multiple products.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {drafts.map((d) => (
            <Card key={d.id} className="flex items-center gap-3 p-3">
              {renamingId === d.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename(d.id)}
                  onBlur={() => handleRename(d.id)}
                  className="flex-1 rounded-md border-[1.5px] border-green-600 px-2 py-1 text-sm outline-none"
                />
              ) : (
                <Link href={`${basePath}/${d.id}`} className="flex-1 font-semibold text-ink hover:underline">
                  {d.name}
                </Link>
              )}
              <span className="text-xs text-gray-500">{d.groupCount} group(s)</span>
              <span className="text-xs text-gray-400">{d.status}</span>
              <span className="text-xs text-gray-400">{formatDateTimeDDMMYYYY(d.updatedAt)}</span>
              <button
                type="button"
                onClick={() => {
                  setRenamingId(d.id);
                  setRenameValue(d.name);
                }}
                className="rounded p-1.5 text-gray-400 hover:bg-bg-dashboard hover:text-ink"
                title="Rename"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(d.id)}
                className="rounded p-1.5 text-gray-400 hover:bg-bg-dashboard hover:text-ink"
                title="Duplicate"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(d.id)}
                className="rounded p-1.5 text-gray-400 hover:bg-danger-bg hover:text-danger"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
