"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, ConfirmDialog, FormTextarea } from "@kisan4u/ui";
import { decideProductAction, deleteProductAction } from "./actions";

type LifecycleStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";
type DecideAction = "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "DEACTIVATE";
type ConfirmKind = "REJECT" | "SUSPEND" | "DEACTIVATE" | "DELETE";

const CONFIRM_COPY: Record<ConfirmKind, { title: string; confirmLabel: string; body: string }> = {
  REJECT: {
    title: "Reject this product?",
    confirmLabel: "Reject",
    body: "The seller will be notified their product was rejected.",
  },
  SUSPEND: {
    title: "Suspend this product?",
    confirmLabel: "Suspend",
    body: "This immediately hides the product from customers until reactivated. This action can be reversed.",
  },
  DEACTIVATE: {
    title: "Deactivate this product?",
    confirmLabel: "Deactivate",
    body: "This hides the product from customers. It can be reactivated later.",
  },
  DELETE: {
    title: "Permanently delete this product?",
    confirmLabel: "Delete",
    body: "This erases the product record, its variants, images, reviews, and cart/wishlist entries completely. It cannot be undone or reversed. Products with order history cannot be deleted.",
  },
};

export function ProductActions({
  productId,
  status,
}: {
  productId: string;
  status: LifecycleStatus;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(action: DecideAction) {
    setError(null);
    startTransition(async () => {
      const result = await decideProductAction({ productId, action, reason: reason || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmKind(null);
      setReason("");
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
      router.push("/admin/products");
    });
  }

  if (status === "DRAFT" || status === "REJECTED") {
    return <span className="text-sm text-gray-600">Waiting on the seller.</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "SUBMITTED" && (
          <>
            <Button variant="primary" onClick={() => act("APPROVE")} loading={isPending}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => setConfirmKind("REJECT")} disabled={isPending}>
              Reject
            </Button>
          </>
        )}
        {status === "APPROVED" && (
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmKind("SUSPEND")}
              disabled={isPending}
            >
              Suspend
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirmKind("DEACTIVATE")}
              disabled={isPending}
            >
              Deactivate
            </Button>
            <Button variant="danger" onClick={() => setConfirmKind("DELETE")} disabled={isPending}>
              Delete
            </Button>
          </>
        )}
        {(status === "SUSPENDED" || status === "INACTIVE") && (
          <Button variant="primary" onClick={() => act("REACTIVATE")} loading={isPending}>
            Reactivate
          </Button>
        )}
      </div>
      {error && !confirmKind && <AlertBox tone="danger">{error}</AlertBox>}

      <ConfirmDialog
        open={!!confirmKind}
        onClose={() => {
          setConfirmKind(null);
          setReason("");
        }}
        onConfirm={() => {
          if (confirmKind === "DELETE") del();
          else if (confirmKind) act(confirmKind);
        }}
        title={confirmKind ? CONFIRM_COPY[confirmKind].title : ""}
        confirmLabel={confirmKind ? CONFIRM_COPY[confirmKind].confirmLabel : ""}
        isPending={isPending}
        description={
          <div className="flex flex-col gap-3">
            <span>{confirmKind ? CONFIRM_COPY[confirmKind].body : ""}</span>
            {confirmKind === "REJECT" && (
              <FormTextarea
                label="Reason"
                hint="Optional, shown to the seller"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            )}
            {error && <AlertBox tone="danger">{error}</AlertBox>}
          </div>
        }
      />
    </div>
  );
}
