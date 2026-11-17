"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, Card, FormInput, FormTextarea } from "@kisan4u/ui";
import { createProductRequestAction } from "../actions";

export function RequestForm({
  product,
  variant,
  defaultAddress,
  dealerStateName,
}: {
  product: { id: string; name: string };
  variant: { id: string; label: string } | null;
  defaultAddress: string;
  dealerStateName: string;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("1");
  // Prefilled from the dealer's own profile, but freely editable for THIS
  // request only — submitting a different address here never writes back
  // to DealerProfile (see actions.ts / packages/catalog/src/
  // product-requests.ts, which never touches the dealer profile row). The
  // delivery STATE, unlike the address, is never editable here — it's
  // always the dealer's own verified state, re-derived server-side, since
  // that's the entire reason this request exists (see
  // packages/catalog/src/product-requests.ts createProductRequest).
  const [deliveryAddress, setDeliveryAddress] = useState(defaultAddress);
  const [neededByDate, setNeededByDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createProductRequestAction({
        productId: product.id,
        variantId: variant?.id || undefined,
        quantity,
        deliveryAddress,
        neededByDate: neededByDate || undefined,
        note: note || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/dealer/requests/${result.requestId}?submitted=${result.publicRequestNumber}`);
      router.refresh();
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormInput label="Product" value={product.name} readOnly disabled />
        {variant && <FormInput label="Selected option" value={variant.label} readOnly disabled />}
        <FormInput
          label="Quantity"
          type="number"
          min={1}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
        <FormTextarea
          label="Delivery address"
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          required
          rows={3}
        />
        <FormInput
          label="Delivery state (your verified state)"
          value={dealerStateName}
          readOnly
          disabled
        />
        <FormInput
          label="Needed by (optional)"
          type="date"
          value={neededByDate}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setNeededByDate(e.target.value)}
        />
        <FormTextarea
          label="Requirement details (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
        />

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Sending…" : "Send Request"}
        </Button>
      </form>
    </Card>
  );
}
