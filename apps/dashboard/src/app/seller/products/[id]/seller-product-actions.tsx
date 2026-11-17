"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, ConfirmDialog, LinkButton } from "@kisan4u/ui";
import { deactivateProductAction, reactivateProductAction, deleteProductAction } from "../actions";

type LifecycleStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
type ConfirmKind = "DEACTIVATE" | "DELETE";

const CONFIRM_COPY: Record<ConfirmKind, { title: string; confirmLabel: string; body: string }> = {
  DEACTIVATE: {
    title: "Deactivate this product?",
    confirmLabel: "Deactivate",
    body: "This immediately pulls it from the storefront. You can activate it again later.",
  },
  DELETE: {
    title: "Permanently delete this product?",
    confirmLabel: "Delete",
    body: "This erases the product record, its variants, images, reviews, and cart/wishlist entries completely. It cannot be undone or reversed. Products with order history cannot be deleted — deactivate those instead.",
  },
};

/**
 * The seller's full action set on their own product: Edit (DRAFT/
 * REJECTED — the usual pre-approval editing case — or APPROVED, editing a
 * live listing, which resubmits it for admin re-review on save; every
 * other status can't be edited at all, see updateProductAction),
 * Deactivate/Activate (their own pull-down/bring-back toggle — never
 * SUSPENDED, which only an admin can set or lift), and Delete (any
 * status, blocked server-side only by real order history). Deliberately
 * NOT the same component as admin's ProductActions
 * (apps/dashboard/src/app/admin/products/product-actions.tsx) — a seller
 * never gets Approve/Reject/Suspend, those stay admin-only decisions.
 */
export function SellerProductActions({
  productId,
  status,
}: {
  productId: string;
  status: LifecycleStatus;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function deactivate() {
    setError(null);
    startTransition(async () => {
      const result = await deactivateProductAction(productId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmKind(null);
      router.refresh();
    });
  }

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateProductAction(productId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function del() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProductAction(productId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/seller/products");
    });
  }

  const editable = status === "DRAFT" || status === "REJECTED" || status === "APPROVED";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {editable && (
          <LinkButton href={`/seller/products/${productId}/edit`} variant="outline">
            Edit
          </LinkButton>
        )}
        {status === "APPROVED" && (
          <Button
            variant="danger"
            onClick={() => setConfirmKind("DEACTIVATE")}
            disabled={isPending}
          >
            Deactivate
          </Button>
        )}
        {status === "INACTIVE" && (
          <Button variant="primary" onClick={activate} loading={isPending}>
            Activate
          </Button>
        )}
        <Button variant="danger" onClick={() => setConfirmKind("DELETE")} disabled={isPending}>
          Delete
        </Button>
      </div>
      {error && !confirmKind && <AlertBox tone="danger">{error}</AlertBox>}

      <ConfirmDialog
        open={!!confirmKind}
        onClose={() => setConfirmKind(null)}
        onConfirm={() => {
          if (confirmKind === "DELETE") del();
          else if (confirmKind === "DEACTIVATE") deactivate();
        }}
        title={confirmKind ? CONFIRM_COPY[confirmKind].title : ""}
        confirmLabel={confirmKind ? CONFIRM_COPY[confirmKind].confirmLabel : ""}
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            <span>{confirmKind ? CONFIRM_COPY[confirmKind].body : ""}</span>
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </div>
  );
}
