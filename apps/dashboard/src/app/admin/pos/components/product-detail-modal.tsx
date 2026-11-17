"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Modal,
  Carousel,
  ProductImage,
  PriceDisplay,
  QuantitySelector,
  Button,
  AlertBox,
  LoadingState,
  VariantPicker,
  FormInput,
  FormTextarea,
} from "@kisan4u/ui";
import {
  getPosProductDetailAction,
  addToPosCartAction,
  createPosProductRequestAction,
  type PosProductDetail,
} from "../actions";
import type { LineValidationResult } from "@kisan4u/orders";
import { CalendarDateField } from "@/components/calendar-date-field";

function PurchaseArea({
  eligibility,
  price,
  minOrderQty,
  onAdd,
  isPending,
  canRequestProduct,
  requestForm,
}: {
  eligibility: LineValidationResult | undefined;
  price: { mrp: number; sellingPrice: number } | null;
  minOrderQty: number;
  onAdd: (quantity: number) => void;
  isPending: boolean;
  canRequestProduct: boolean;
  requestForm: React.ReactNode;
}) {
  const [quantity, setQuantity] = useState(minOrderQty);

  useEffect(() => setQuantity(minOrderQty), [minOrderQty]);

  if (!eligibility) return <AlertBox tone="info">Loading availability…</AlertBox>;

  if (!eligibility.ok) {
    if (eligibility.code === "STATE_UNAVAILABLE" && canRequestProduct) {
      return (
        <div className="flex flex-col gap-3">
          <AlertBox tone="warning">
            Not available in this dealer's state. No price is shown for this product.
          </AlertBox>
          {requestForm}
        </div>
      );
    }
    return <AlertBox tone="danger">{eligibility.error}</AlertBox>;
  }

  return (
    <div className="flex flex-col gap-3">
      {price && (
        <PriceDisplay
          price={price.sellingPrice}
          originalPrice={price.mrp !== price.sellingPrice ? price.mrp : null}
          size="lg"
        />
      )}
      <div className="flex items-center gap-3">
        <QuantitySelector
          value={quantity}
          onDecrease={() => setQuantity((q) => Math.max(minOrderQty, q - 1))}
          onIncrease={() => setQuantity((q) => q + 1)}
          min={minOrderQty}
          max={eligibility.line.currentStock}
        />
        <span className="text-xs text-gray-500">
          Min {minOrderQty} · {eligibility.line.currentStock} in stock
        </span>
      </div>
      <Button type="button" variant="primary" onClick={() => onAdd(quantity)} disabled={isPending}>
        {isPending ? "Adding…" : "Add to Cart"}
      </Button>
    </div>
  );
}

export function ProductDetailModal({
  open,
  onClose,
  targetUserId,
  productId,
  deliveryAddressText,
  dealerStateName,
  onAddedToCart,
  onRequestSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  productId: string | null;
  deliveryAddressText: string | null;
  dealerStateName: string | null;
  onAddedToCart: () => void;
  onRequestSubmitted: () => void;
}) {
  const [detail, setDetail] = useState<PosProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();
  const [requestQty, setRequestQty] = useState(1);
  const [requestNeededBy, setRequestNeededBy] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isRequesting, startRequesting] = useTransition();

  useEffect(() => {
    if (!open || !productId) return;
    setDetail(null);
    setError(null);
    setAddError(null);
    setRequestSubmitted(false);
    setRequestError(null);
    getPosProductDetailAction(targetUserId, productId).then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDetail(result.data);
    });
  }, [open, productId, targetUserId]);

  function handleAdd(variantId: string | null, quantity: number) {
    setAddError(null);
    startAdding(async () => {
      const result = await addToPosCartAction(targetUserId, {
        productId,
        variantId: variantId ?? undefined,
        quantity,
      });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      onAddedToCart();
      onClose();
    });
  }

  function handleRequest(variantId: string | null) {
    setRequestError(null);
    startRequesting(async () => {
      const result = await createPosProductRequestAction(targetUserId, {
        productId,
        variantId: variantId ?? undefined,
        quantity: requestQty,
        deliveryAddress: deliveryAddressText ?? "",
        neededByDate: requestNeededBy || undefined,
        note: requestNote || undefined,
      });
      if (!result.ok) {
        setRequestError(result.error);
        return;
      }
      setRequestSubmitted(true);
      onRequestSubmitted();
    });
  }

  function requestFormFor(variantId: string | null) {
    if (requestSubmitted)
      return <AlertBox tone="success">Request sent — awaiting seller/admin review.</AlertBox>;
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-600">
          Request This Product
        </div>
        <FormInput
          label="Quantity"
          type="number"
          min={1}
          value={requestQty}
          onChange={(e) => setRequestQty(Math.max(1, Number(e.target.value) || 1))}
          required
        />
        <CalendarDateField
          label="Needed by (optional)"
          value={requestNeededBy}
          min={new Date().toISOString().slice(0, 10)}
          onChange={setRequestNeededBy}
        />
        <FormTextarea
          label="Requirement details (optional)"
          value={requestNote}
          onChange={(e) => setRequestNote(e.target.value)}
          maxLength={500}
          rows={2}
        />
        {!deliveryAddressText && (
          <AlertBox tone="warning">
            Select a delivery address for this dealer before sending a request.
          </AlertBox>
        )}
        {requestError && <AlertBox tone="danger">{requestError}</AlertBox>}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => handleRequest(variantId)}
          disabled={isRequesting || !deliveryAddressText}
        >
          {isRequesting ? "Sending…" : "Send Request"}
        </Button>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={detail?.name ?? "Product"} className="max-w-3xl">
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      {!error && !detail && <LoadingState label="Loading product…" />}
      {detail && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="aspect-square overflow-hidden rounded-xl border border-border">
            {detail.images.length > 1 ? (
              <Carousel
                ariaLabel={detail.name}
                slides={detail.images.map((img) => (
                  <ProductImage key={img.id} src={img.url} alt={img.altText ?? detail.name} />
                ))}
              />
            ) : (
              <ProductImage src={detail.images[0]?.url} alt={detail.name} />
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-extrabold text-ink">{detail.name}</h2>
            {detail.sellerName && (
              <p className="text-sm text-gray-500">Sold by {detail.sellerName}</p>
            )}
            {dealerStateName && detail.role === "DEALER" && (
              <p className="text-xs text-gray-400">Dealer state: {dealerStateName}</p>
            )}
            {detail.shortDescription && (
              <p className="text-sm text-gray-600">{detail.shortDescription}</p>
            )}

            {addError && <AlertBox tone="danger">{addError}</AlertBox>}

            {detail.variants.length > 0 ? (
              <VariantPicker
                variants={detail.variants}
                defaultVariantId={detail.defaultVariantId}
                renderPurchaseArea={(resolved) => (
                  <PurchaseArea
                    eligibility={detail.eligibility[resolved.id]}
                    price={{
                      mrp: Number(resolved.mrp),
                      sellingPrice: Number(resolved.sellingPrice),
                    }}
                    minOrderQty={resolved.minOrderQty}
                    onAdd={(qty) => handleAdd(resolved.id, qty)}
                    isPending={isAdding}
                    canRequestProduct={detail.canRequestProduct}
                    requestForm={requestFormFor(resolved.id)}
                  />
                )}
              />
            ) : detail.baseConfig ? (
              <PurchaseArea
                eligibility={detail.eligibility[""]}
                price={{ mrp: detail.baseConfig.mrp, sellingPrice: detail.baseConfig.sellingPrice }}
                minOrderQty={detail.baseConfig.minOrderQty}
                onAdd={(qty) => handleAdd(null, qty)}
                isPending={isAdding}
                canRequestProduct={detail.canRequestProduct}
                requestForm={requestFormFor(null)}
              />
            ) : (
              <AlertBox tone="danger">This product has no purchasable configuration.</AlertBox>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
