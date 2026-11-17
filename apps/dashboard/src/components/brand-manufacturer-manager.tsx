"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Pencil, PowerOff, RotateCcw, ShieldAlert, Tags, X } from "lucide-react";
import {
  AdminDataTable,
  AlertBox,
  Button,
  Card,
  ConfirmDialog,
  FormInput,
  FormTextarea,
  IdentityCell,
  ImageUploadField,
  RowActionMenu,
  StatusBadge,
  Truncate,
  type DataTableColumn,
  type ImageUploadResult,
  type RowAction,
} from "@kisan4u/ui";
import { buildStorefrontAssetUrl } from "@/lib/storefront-url";

export type BrandManufacturerItem = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
  rejectionReason: string | null;
  ownerSellerId: string | null;
  ownerSellerName: string | null;
  /** Only meaningful when hasHomepageRank is set (Brands): the "Shop by Brand" homepage rank, null = not featured. */
  homepagePosition?: number | null;
};

type Result = { ok: true } | { ok: false; error: string };
type DecideAction = "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "DEACTIVATE";
type ConfirmState = { item: BrandManufacturerItem; action: "REJECT" | "SUSPEND" | "DEACTIVATE" };

/**
 * Admin-only manager for Brand/Manufacturer once they carry a real
 * approval workflow instead of a plain isActive flag — creating here
 * always produces a global (ownerSellerId null), immediately-APPROVED
 * entry (see the onCreate action passed in), since an admin isn't
 * "requesting" anything. Seller-submitted requests only ever appear here
 * as PENDING rows to decide on, never created from this form.
 */
export function BrandManufacturerManager({
  label,
  items,
  onCreate,
  onUpdate,
  onDecide,
  onUploadImage,
  storefrontBaseUrl,
  hasHomepageRank = false,
  onSetHomepageRank,
}: {
  label: string;
  items: BrandManufacturerItem[];
  storefrontBaseUrl?: string | null;
  onCreate: (input: {
    name: string;
    slug: string;
    imageUrl?: string;
    id?: string;
  }) => Promise<Result>;
  onUpdate: (
    id: string,
    input: { name: string; slug: string; imageUrl?: string },
  ) => Promise<Result>;
  onDecide: (input: { id: string; action: DecideAction; reason?: string }) => Promise<Result>;
  onUploadImage: (id: string, slug: string, file: File) => Promise<ImageUploadResult>;
  /** Brands only — adds a "Homepage rank" column (dropdown 1..N of approved rows + "Not featured"). */
  hasHomepageRank?: boolean;
  onSetHomepageRank?: (id: string, position: number | null) => Promise<Result>;
}) {
  const displaySrc = (url: string) => (url ? buildStorefrontAssetUrl(url, storefrontBaseUrl) : url);
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [rankOverride, setRankOverride] = useState<Record<string, string>>({});

  const pending = items.filter((i) => i.status === "PENDING");
  const rankCount = items.filter((i) => i.status === "APPROVED").length;

  function setRank(id: string, raw: string) {
    if (!onSetHomepageRank) return;
    setRankOverride((o) => ({ ...o, [id]: raw }));
    startTransition(async () => {
      await onSetHomepageRank(id, raw === "" ? null : Number(raw));
      router.refresh();
    });
  }

  function resetForm() {
    setName("");
    setSlug("");
    setImageUrl("");
    setEditingId(null);
    setPendingId(null);
    setError(null);
  }
  function startEdit(item: BrandManufacturerItem) {
    setEditingId(item.id);
    setPendingId(null);
    setName(item.name);
    setSlug(item.slug);
    setImageUrl(item.imageUrl ?? "");
    setError(null);
  }
  async function handleImageUpload(file: File) {
    const id = editingId ?? pendingId ?? crypto.randomUUID();
    if (!editingId && !pendingId) setPendingId(id);
    return onUploadImage(id, slug || "item", file);
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = {
        name,
        slug,
        imageUrl: imageUrl || undefined,
        ...(editingId ? {} : pendingId ? { id: pendingId } : {}),
      };
      const result = editingId ? await onUpdate(editingId, input) : await onCreate(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }
  function decide(id: string, action: DecideAction, decideReason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await onDecide({ id, action, reason: decideReason || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      setReason("");
      router.refresh();
    });
  }

  function actionsFor(item: BrandManufacturerItem): { actions: RowAction[]; primaryCount: number } {
    const primary: RowAction[] = [];
    const rest: RowAction[] = [];
    const canApprove = item.status === "PENDING" || item.status === "REJECTED";

    if (canApprove) {
      primary.push({
        label: `Approve ${item.name}`,
        icon: <Check className="h-4 w-4" aria-hidden="true" />,
        onClick: () => decide(item.id, "APPROVE"),
        disabled: isPending,
      });
      rest.push({
        label: `Edit ${item.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(item),
        disabled: isPending,
      });
    } else {
      primary.push({
        label: `Edit ${item.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => startEdit(item),
        disabled: isPending,
      });
    }
    if (item.status === "PENDING") {
      rest.push({
        label: `Reject ${item.name}`,
        icon: <X className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setConfirm({ item, action: "REJECT" }),
        disabled: isPending,
      });
    }
    if (item.status === "APPROVED") {
      rest.push({
        label: `Suspend ${item.name}`,
        icon: <Ban className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setConfirm({ item, action: "SUSPEND" }),
        disabled: isPending,
      });
      rest.push({
        label: `Deactivate ${item.name}`,
        icon: <PowerOff className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setConfirm({ item, action: "DEACTIVATE" }),
        disabled: isPending,
      });
    }
    if (item.status === "SUSPENDED" || item.status === "INACTIVE") {
      rest.push({
        label: `Reactivate ${item.name}`,
        icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
        onClick: () => decide(item.id, "REACTIVATE"),
        disabled: isPending,
      });
    }
    return { actions: [...primary, ...rest], primaryCount: primary.length };
  }

  const columns: DataTableColumn<BrandManufacturerItem>[] = [
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
        <Truncate value={item.slug} className="font-mono text-xs text-gray-600" maxWidth="160px" />
      ),
    },
    {
      key: "owner",
      header: "Owner",
      sortable: true,
      value: (item) => item.ownerSellerName ?? "Global (admin)",
      render: (item) =>
        item.ownerSellerName ? (
          <span className="text-ink">{item.ownerSellerName}</span>
        ) : (
          <span className="text-gray-500">Global (admin)</span>
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
    ...(hasHomepageRank
      ? [
          {
            key: "homepageRank",
            header: "Homepage rank",
            value: (item: BrandManufacturerItem) => item.homepagePosition ?? 999,
            render: (item: BrandManufacturerItem) =>
              item.status === "APPROVED" ? (
                <select
                  value={rankOverride[item.id] ?? (item.homepagePosition?.toString() ?? "")}
                  onChange={(e) => setRank(item.id, e.target.value)}
                  disabled={isPending}
                  className="w-36 rounded-md border-[1.5px] border-border px-2 py-1.5 text-sm disabled:opacity-60"
                  aria-label={`Homepage rank for ${item.name}`}
                >
                  <option value="">Not featured</option>
                  {Array.from({ length: rankCount }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Rank {n}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-gray-400">—</span>
              ),
          } as DataTableColumn<BrandManufacturerItem>,
        ]
      : []),
  ];

  function renderActions(item: BrandManufacturerItem) {
    const { actions, primaryCount } = actionsFor(item);
    return <RowActionMenu actions={actions} maxInline={primaryCount} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {editingId ? `Edit ${label}` : `New global ${label}`}
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
            <div className="sm:col-span-2">
              <ImageUploadField
                label="Image"
                hint="Optional"
                value={imageUrl}
                onChange={setImageUrl}
                onUpload={handleImageUpload}
                onUploadingChange={setUploading}
                resolveDisplaySrc={displaySrc}
              />
            </div>
          </div>
          {error && !confirm && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" loading={isPending} disabled={uploading}>
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

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
            <h3 className="text-sm font-extrabold text-ink">Pending requests ({pending.length})</h3>
          </div>
          <AdminDataTable
            data={pending}
            columns={columns}
            rowKey={(item) => item.id}
            renderActions={renderActions}
            caption={`Pending ${label} requests`}
            searchPlaceholder={`Search pending ${label.toLowerCase()}s…`}
            emptyTitle="Nothing pending"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="px-1 text-sm font-extrabold text-ink">All {label.toLowerCase()}s</h3>
        <AdminDataTable
          data={items}
          columns={columns}
          rowKey={(item) => item.id}
          renderActions={renderActions}
          caption={`${label} list`}
          searchPlaceholder={`Search ${label.toLowerCase()}s…`}
          emptyIcon={<Tags className="h-8 w-8" aria-hidden="true" />}
          emptyTitle={`No ${label.toLowerCase()}s yet`}
          emptyDescription={`Create your first global ${label.toLowerCase()} using the form above.`}
        />
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => {
          setConfirm(null);
          setReason("");
        }}
        onConfirm={() =>
          confirm &&
          decide(confirm.item.id, confirm.action, confirm.action === "REJECT" ? reason : undefined)
        }
        title={
          confirm
            ? `${confirm.action === "REJECT" ? "Reject" : confirm.action === "SUSPEND" ? "Suspend" : "Deactivate"} ${confirm.item.name}?`
            : ""
        }
        confirmLabel={
          confirm?.action === "REJECT"
            ? "Reject"
            : confirm?.action === "SUSPEND"
              ? "Suspend"
              : "Deactivate"
        }
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            {confirm?.action === "REJECT" ? (
              <>
                <span>
                  This tells the seller their submission was rejected. You can add a reason so they
                  know what to fix.
                </span>
                <FormTextarea
                  label="Rejection reason"
                  hint="Optional, shown to the seller"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </>
            ) : confirm?.action === "SUSPEND" ? (
              <span>
                This immediately hides {confirm.item.name} from sellers using it until reactivated.
                This action can be reversed.
              </span>
            ) : (
              <span>
                This deactivates {confirm?.item.name}. It can be reactivated later. This action can
                be reversed.
              </span>
            )}
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </div>
  );
}
