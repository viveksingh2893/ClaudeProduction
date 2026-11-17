"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Pencil, Power } from "lucide-react";
import {
  ActiveBadge,
  AdminDataTable,
  AlertBox,
  Badge,
  Button,
  Card,
  FormInput,
  FormSelect,
  RowActionMenu,
  Truncate,
  type BadgeTone,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import {
  createEditorialBadgeAction,
  updateEditorialBadgeAction,
  toggleEditorialBadgeActiveAction,
} from "./actions";

export type EditorialBadgeRow = {
  id: string;
  name: string;
  slug: string;
  tone: "SUCCESS" | "WARNING" | "DANGER" | "INFO";
  kind: "EDITORIAL" | "DEAL";
  isActive: boolean;
  position: number;
};

type MutationResult = { ok: true } | { ok: false; error: string };

const TONE_OPTIONS: { value: EditorialBadgeRow["tone"]; label: string }[] = [
  { value: "SUCCESS", label: "Success (green)" },
  { value: "WARNING", label: "Warning (amber)" },
  { value: "DANGER", label: "Danger (red)" },
  { value: "INFO", label: "Info (blue)" },
];

const KIND_OPTIONS: { value: EditorialBadgeRow["kind"]; label: string }[] = [
  { value: "EDITORIAL", label: "Editorial (e.g. Best Seller, New, Trending)" },
  { value: "DEAL", label: "Deal (outranks delivery/editorial badges on the card)" },
];

function toBadgeTone(tone: EditorialBadgeRow["tone"]): BadgeTone {
  return tone.toLowerCase() as BadgeTone;
}

/**
 * Same create/edit/list/toggle-active shape as MasterDataManager (see
 * @/components/master-data-manager), but a dedicated component rather
 * than extending that shared one: tone + kind + position are genuinely
 * specific to this resource, the same reasoning that already keeps
 * Category/Subcategory out of the shared component too.
 */
export function EditorialBadgesManager({ badges }: { badges: EditorialBadgeRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tone, setTone] = useState<EditorialBadgeRow["tone"]>("SUCCESS");
  const [kind, setKind] = useState<EditorialBadgeRow["kind"]>("EDITORIAL");
  const [position, setPosition] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetForm() {
    setName("");
    setSlug("");
    setTone("SUCCESS");
    setKind("EDITORIAL");
    setPosition("0");
    setEditingId(null);
    setError(null);
  }

  function startEdit(item: EditorialBadgeRow) {
    setEditingId(item.id);
    setName(item.name);
    setSlug(item.slug);
    setTone(item.tone);
    setKind(item.kind);
    setPosition(String(item.position));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = { name, slug, tone, kind, position: Number(position) || 0 };
      const result: MutationResult = editingId
        ? await updateEditorialBadgeAction(editingId, input)
        : await createEditorialBadgeAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  function handleToggle(item: EditorialBadgeRow) {
    setError(null);
    startTransition(async () => {
      const result = await toggleEditorialBadgeActiveAction(item.id, !item.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const columns: DataTableColumn<EditorialBadgeRow>[] = [
    {
      key: "name",
      header: "Badge",
      primary: true,
      sortable: true,
      value: (item) => item.name,
      render: (item) => <Badge tone={toBadgeTone(item.tone)}>{item.name}</Badge>,
    },
    {
      key: "slug",
      header: "Slug",
      sortable: true,
      value: (item) => item.slug,
      render: (item) => (
        <Truncate value={item.slug} className="font-mono text-xs text-gray-600" maxWidth="180px" />
      ),
    },
    {
      key: "kind",
      header: "Priority slot",
      value: (item) => item.kind,
      render: (item) => (
        <span className="text-xs text-gray-600">
          {item.kind === "DEAL" ? "Deal (2nd priority)" : "Editorial (4th priority)"}
        </span>
      ),
    },
    {
      key: "position",
      header: "Order",
      align: "right",
      sortable: true,
      value: (item) => item.position,
      render: (item) => <span className="text-gray-600">{item.position}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      value: (item) => (item.isActive ? "Active" : "Inactive"),
      render: (item) => <ActiveBadge active={item.isActive} />,
    },
  ];

  function actionsFor(item: EditorialBadgeRow): RowAction[] {
    return [
      {
        label: `Edit ${item.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(item),
        disabled: isPending,
      },
      {
        label: item.isActive ? `Deactivate ${item.name}` : `Activate ${item.name}`,
        icon: <Power className="h-4 w-4" aria-hidden="true" />,
        onClick: () => handleToggle(item),
        disabled: isPending,
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {editingId ? `Edit badge` : `New badge`}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="Name"
              hint='Shown on the product card, e.g. "Best Seller"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isPending}
            />
            <FormInput
              label="Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              disabled={isPending}
            />
            <FormSelect
              label="Colour (tone)"
              value={tone}
              onChange={(e) => setTone(e.target.value as EditorialBadgeRow["tone"])}
              disabled={isPending}
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Priority slot"
              hint="Deal badges outrank delivery/editorial badges on the card — see Product Card Design Spec §Badge priority"
              value={kind}
              onChange={(e) => setKind(e.target.value as EditorialBadgeRow["kind"])}
              disabled={isPending}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="Display order"
              type="number"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              disabled={isPending}
            />
          </div>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" loading={isPending}>
              {editingId ? "Save changes" : "Create"}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={isPending}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      <AdminDataTable
        data={badges}
        columns={columns}
        rowKey={(item) => item.id}
        renderActions={(item) => <RowActionMenu actions={actionsFor(item)} />}
        caption="Editorial badges"
        searchPlaceholder="Search badges…"
        emptyIcon={<Layers className="h-8 w-8" aria-hidden="true" />}
        emptyTitle="No editorial badges yet"
        emptyDescription="Create your first badge using the form above — it'll be selectable from every product's Editorial badge dropdown."
      />
    </div>
  );
}
