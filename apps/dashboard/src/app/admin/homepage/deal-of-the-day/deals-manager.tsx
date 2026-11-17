"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  FormInput,
  RecordList,
  RecordListRow,
  RowActionMenu,
  formatDateTimeDDMMYYYY,
  type BadgeTone,
  type RowAction,
} from "@kisan4u/ui";
import { ProductPicker, type PickerProduct } from "@/components/product-picker";
import { saveDealOfTheDayAction, deleteDealOfTheDayAction, searchProductsAction } from "../actions";

/** Plain-object shape built explicitly in page.tsx — see that file's doc comment on why (Decimal serialization across the Server->Client boundary). */
type Deal = {
  id: string;
  productId: string;
  variantId: string | null;
  dealPrice: number;
  startAt: Date;
  endAt: Date;
  isActive: boolean;
  product: { id: string; name: string; slug: string };
  variant: { id: string; sku: string } | null;
};

function toLocalInputValue(d: Date): string {
  const dt = new Date(d);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 16);
}

const EMPTY = {
  id: undefined as string | undefined,
  dealPrice: "",
  startAt: "",
  endAt: "",
  isActive: true,
};

/** Computed (not stored) status — live/scheduled/expired against `now`, or inactive when the deal is switched off outright. */
type DealStatus = "live" | "scheduled" | "expired" | "inactive";

const STATUS_TONE: Record<DealStatus, BadgeTone> = {
  live: "success",
  scheduled: "info",
  expired: "neutral",
  inactive: "neutral",
};

function statusOf(d: Deal): DealStatus {
  const now = new Date();
  if (!d.isActive) return "inactive";
  if (now < d.startAt) return "scheduled";
  if (now >= d.endAt) return "expired";
  return "live";
}

export function DealsManager({ deals }: { deals: Deal[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [product, setProduct] = useState<PickerProduct[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Deal | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (product.length === 0) {
      setError("Select a product for this deal.");
      return;
    }
    startTransition(async () => {
      const result = await saveDealOfTheDayAction({
        id: form.id,
        productId: product[0]!.id,
        dealPrice: Number(form.dealPrice),
        startAt: form.startAt,
        endAt: form.endAt,
        isActive: form.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(EMPTY);
      setProduct([]);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startTransition(async () => {
      await deleteDealOfTheDayAction(id);
      setPendingDelete(null);
      if (form.id === id) {
        setForm(EMPTY);
        setProduct([]);
      }
      router.refresh();
    });
  }

  function actionsFor(d: Deal): RowAction[] {
    return [
      {
        label: `Edit deal on ${d.product.name}`,
        icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
        onClick: () => {
          setForm({
            id: d.id,
            dealPrice: d.dealPrice.toString(),
            startAt: toLocalInputValue(d.startAt),
            endAt: toLocalInputValue(d.endAt),
            isActive: d.isActive,
          });
          setProduct([{ id: d.product.id, name: d.product.name, slug: d.product.slug }]);
        },
        disabled: isPending,
      },
      {
        label: `Delete deal on ${d.product.name}`,
        icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
        tone: "danger",
        onClick: () => setPendingDelete(d),
        disabled: isPending,
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {deals.length === 0 ? (
        <p className="text-sm text-gray-500">No deals configured yet.</p>
      ) : (
        <RecordList>
          {deals.map((d) => {
            const status = statusOf(d);
            return (
              <RecordListRow key={d.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-ink">
                    {d.product.name} — ₹{d.dealPrice.toString()}
                    <Badge tone={STATUS_TONE[status]}>{status.toUpperCase()}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDateTimeDDMMYYYY(d.startAt)} → {formatDateTimeDDMMYYYY(d.endAt)}
                  </div>
                </div>
                <RowActionMenu actions={actionsFor(d)} />
              </RecordListRow>
            );
          })}
        </RecordList>
      )}

      <Card className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold text-green-800">
            {form.id ? "Edit deal" : "Add deal"}
          </h2>
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-gray-600">Product</div>
            <ProductPicker
              selected={product}
              onChange={setProduct}
              onSearch={searchProductsAction}
              max={1}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormInput
              label="Deal price (₹)"
              type="number"
              required
              value={form.dealPrice}
              onChange={(e) => setForm((f) => ({ ...f, dealPrice: e.target.value }))}
              disabled={isPending}
            />
            <FormInput
              label="Start"
              type="datetime-local"
              required
              value={form.startAt}
              onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
              disabled={isPending}
            />
            <FormInput
              label="End"
              type="datetime-local"
              required
              value={form.endAt}
              onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
              disabled={isPending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active
          </label>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={isPending}>
              {form.id ? "Save changes" : "Add deal"}
            </Button>
            {form.id && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setForm(EMPTY);
                  setProduct([]);
                }}
                disabled={isPending}
              >
                Cancel edit
              </Button>
            )}
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={pendingDelete ? `Delete the deal on "${pendingDelete.product.name}"?` : ""}
        description="This removes the Deal of the Day entry immediately. This can't be undone."
        confirmLabel="Delete"
        isPending={isPending}
      />
    </div>
  );
}
