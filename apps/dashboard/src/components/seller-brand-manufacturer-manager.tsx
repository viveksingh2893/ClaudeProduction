"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Tags } from "lucide-react";
import {
  AdminDataTable,
  AlertBox,
  Button,
  Card,
  FormInput,
  IdentityCell,
  RowActionMenu,
  StatusBadge,
  Truncate,
  type DataTableColumn,
  type RowAction,
} from "@kisan4u/ui";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

export type SellerBrandManufacturerItem = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
  rejectionReason: string | null;
};

type Result = { ok: true } | { ok: false; error: string };

/**
 * Seller-facing submit/edit form for their own brand/manufacturer
 * requests — no approve/reject here (that's admin-only, see
 * apps/dashboard/src/components/brand-manufacturer-manager.tsx, which
 * this mirrors: same Card-form-above/AdminDataTable-below shape, client
 * mode since a single seller's own brand/manufacturer requests are a
 * small list, same as that admin component's global list). Editing is
 * only offered for PENDING/REJECTED rows: once APPROVED, the server
 * (assertSellerOwnsEditableBrand/Manufacturer) refuses further edits from
 * this exact same action, so hiding the button here is just UX, not the
 * real security boundary.
 */
export function SellerBrandManufacturerManager({
  label,
  items,
  onCreate,
  onUpdate,
  storefrontBaseUrl,
}: {
  label: string;
  items: SellerBrandManufacturerItem[];
  onCreate: (input: { name: string; slug: string; imageUrl?: string }) => Promise<Result>;
  onUpdate: (
    id: string,
    input: { name: string; slug: string; imageUrl?: string },
  ) => Promise<Result>;
  storefrontBaseUrl?: string | null;
}) {
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetForm() {
    setName("");
    setSlug("");
    setImageUrl("");
    setEditingId(null);
    setError(null);
  }
  function startEdit(item: SellerBrandManufacturerItem) {
    setEditingId(item.id);
    setName(item.name);
    setSlug(item.slug);
    setImageUrl(item.imageUrl ?? "");
    setError(null);
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = { name, slug, imageUrl: imageUrl || undefined };
      const result = editingId ? await onUpdate(editingId, input) : await onCreate(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  const columns: DataTableColumn<SellerBrandManufacturerItem>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      value: (item) => item.name,
      render: (item) => (
        <IdentityCell name={item.name} avatarUrl={item.imageUrl ? displaySrc(item.imageUrl) : item.imageUrl} />
      ),
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
      key: "status",
      header: "Status",
      sortable: true,
      value: (item) => item.status,
      render: (item) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={item.status} />
          {item.status === "REJECTED" && item.rejectionReason && (
            <span className="text-xs text-gray-500">{item.rejectionReason}</span>
          )}
        </div>
      ),
    },
  ];

  function actionsFor(item: SellerBrandManufacturerItem): RowAction[] {
    if (item.status !== "PENDING" && item.status !== "REJECTED") return [];
    return [
      {
        label: `Edit ${item.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(item),
        disabled: isPending,
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {editingId
              ? `Edit ${label.toLowerCase()} request`
              : `Submit a new ${label.toLowerCase()}`}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="Name"
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
            <FormInput
              label="Image URL"
              hint="Optional"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              disabled={isPending}
              className="sm:col-span-2"
            />
          </div>
          <p className="text-xs text-gray-500">
            Saving submits this {label.toLowerCase()} for admin approval — once approved, it&apos;s
            yours to use on your own products, no other seller can select it.
          </p>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" loading={isPending}>
              {editingId ? "Save changes" : "Submit for approval"}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={isPending}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="px-1 text-sm font-extrabold text-ink">
          Your {label.toLowerCase()} requests
        </h3>
        <AdminDataTable
          data={items}
          columns={columns}
          rowKey={(item) => item.id}
          renderActions={(item) => {
            const actions = actionsFor(item);
            return actions.length > 0 ? <RowActionMenu actions={actions} /> : null;
          }}
          caption={`${label} requests`}
          searchPlaceholder={`Search ${label.toLowerCase()}s…`}
          emptyIcon={<Tags className="h-8 w-8" aria-hidden="true" />}
          emptyTitle={`No ${label.toLowerCase()} requests yet`}
          emptyDescription={`Submit your first ${label.toLowerCase()} using the form above.`}
        />
      </div>
    </div>
  );
}
