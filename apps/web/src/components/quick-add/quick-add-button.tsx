"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type PlainVariant,
} from "@kisan4u/ui";
import { computeUnitPrice } from "@kisan4u/catalog/variant-compatibility";
import { addToCartAction } from "@/app/cart/actions";
import { trackAddToCart } from "@/lib/meta/track";
import { getQuickAddDetailAction, type QuickAddDetail } from "./actions";

/**
 * The "Select size" pill on a listing card — the storefront's green
 * outline CTA language (same as the Add to Cart button), scaled down for
 * the card. Opens the same popup the POS product grid uses — product
 * image, variant selector, price, quantity, Add to Cart — but without any
 * "X in stock" figure. Adding drops the chosen variant straight into the
 * storefront cart.
 */
export function QuickAddButton({
  productId,
  productHref,
  label = "Select size",
}: {
  productId: string;
  productHref: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 whitespace-nowrap rounded-md border-[1.5px] border-green-600 bg-surface px-2.5 py-1 text-[11px] font-bold text-green-700 transition-colors hover:bg-green-50 active:bg-green-100"
      >
        {label}
      </button>
      {open && (
        <QuickAddModal
          productId={productId}
          productHref={productHref}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QuickAddModal({
  productId,
  productHref,
  onClose,
}: {
  productId: string;
  productHref: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<QuickAddDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [isAdding, startAdding] = useTransition();

  useEffect(() => {
    let alive = true;
    getQuickAddDetailAction(productId).then((res) => {
      if (!alive) return;
      if (!res.ok) setLoadError(res.error);
      else setDetail(res.data);
    });
    return () => {
      alive = false;
    };
  }, [productId]);

  function handleAdd(variantId: string | null, quantity: number) {
    setAddError(null);
    startAdding(async () => {
      const res = await addToCartAction({ productId, variantId: variantId ?? undefined, quantity });
      if (!res.ok) {
        setAddError(res.error);
        return;
      }
      trackAddToCart(res.meta, quantity);
      setAdded(true);
      router.refresh();
      setTimeout(onClose, 700);
    });
  }

  return (
    <Modal open onClose={onClose} title={detail?.name ?? "Select an option"} className="max-w-2xl">
      {loadError && <AlertBox tone="danger">{loadError}</AlertBox>}
      {!loadError && !detail && <LoadingState label="Loading options…" />}

      {detail && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
            {detail.sellerName && (
              <p className="text-xs text-gray-500">
                Sold by <span className="font-semibold text-green-700">{detail.sellerName}</span>
              </p>
            )}
            {detail.shortDescription && (
              <p className="line-clamp-3 text-sm text-gray-600">{detail.shortDescription}</p>
            )}

            {addError && <AlertBox tone="danger">{addError}</AlertBox>}
            {added && <AlertBox tone="success">Added to cart ✓</AlertBox>}

            {!detail.purchasable ? (
              <div className="flex flex-col gap-3">
                <AlertBox tone="warning">
                  {detail.unavailableReason ?? "This product can't be added from here."}
                </AlertBox>
                <Link
                  href={productHref}
                  className="text-sm font-bold text-green-700 underline"
                  onClick={onClose}
                >
                  Open product page
                </Link>
              </div>
            ) : detail.variants.length > 0 ? (
              <VariantPicker
                variants={detail.variants}
                defaultVariantId={detail.defaultVariantId}
                renderPurchaseArea={(resolved) => (
                  <PurchaseArea
                    variant={resolved}
                    onAdd={(qty) => handleAdd(resolved.id, qty)}
                    isPending={isAdding}
                    added={added}
                  />
                )}
              />
            ) : detail.baseConfig ? (
              <BasePurchaseArea
                config={detail.baseConfig}
                onAdd={(qty) => handleAdd(null, qty)}
                isPending={isAdding}
                added={added}
              />
            ) : (
              <AlertBox tone="danger">This product has no purchasable option.</AlertBox>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PurchaseArea({
  variant,
  onAdd,
  isPending,
  added,
}: {
  variant: PlainVariant;
  onAdd: (quantity: number) => void;
  isPending: boolean;
  added: boolean;
}) {
  const minQty = variant.minOrderQty;
  const [quantity, setQuantity] = useState(minQty);
  useEffect(() => setQuantity(minQty), [minQty]);

  const outOfStock = variant.stockQty <= 0;

  return (
    <div className="flex flex-col gap-3">
      <PriceDisplay
        price={variant.sellingPrice}
        originalPrice={variant.mrp !== variant.sellingPrice ? variant.mrp : null}
        size="lg"
      />
      {(() => {
        const unitPrice = computeUnitPrice(variant.sellingPrice, variant.attributeValues);
        return (
          unitPrice != null && (
            <p className="text-xs text-gray-600">₹{unitPrice.toFixed(2)} per unit</p>
          )
        );
      })()}
      {outOfStock ? (
        <span className="w-fit rounded-md border border-border px-3 py-2 text-xs font-bold text-gray-400">
          Out of stock
        </span>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <QuantitySelector
              value={quantity}
              onDecrease={() => setQuantity((q) => Math.max(minQty, q - 1))}
              onIncrease={() => setQuantity((q) => Math.min(variant.stockQty, q + 1))}
              min={minQty}
              max={variant.stockQty}
            />
            {minQty > 1 && <span className="text-xs text-gray-500">Min {minQty}</span>}
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => onAdd(quantity)}
            disabled={isPending || added}
          >
            {isPending ? "Adding…" : added ? "Added ✓" : "Add to Cart"}
          </Button>
        </>
      )}
    </div>
  );
}

function BasePurchaseArea({
  config,
  onAdd,
  isPending,
  added,
}: {
  config: { minOrderQty: number; mrp: number; sellingPrice: number; inStock: boolean };
  onAdd: (quantity: number) => void;
  isPending: boolean;
  added: boolean;
}) {
  const minQty = Math.max(1, config.minOrderQty);
  const [quantity, setQuantity] = useState(minQty);
  useEffect(() => setQuantity(minQty), [minQty]);

  return (
    <div className="flex flex-col gap-3">
      <PriceDisplay
        price={config.sellingPrice}
        originalPrice={config.mrp !== config.sellingPrice ? config.mrp : null}
        size="lg"
      />
      {!config.inStock ? (
        <span className="w-fit rounded-md border border-border px-3 py-2 text-xs font-bold text-gray-400">
          Out of stock
        </span>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <QuantitySelector
              value={quantity}
              onDecrease={() => setQuantity((q) => Math.max(minQty, q - 1))}
              onIncrease={() => setQuantity((q) => q + 1)}
              min={minQty}
            />
            {minQty > 1 && <span className="text-xs text-gray-500">Min {minQty}</span>}
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => onAdd(quantity)}
            disabled={isPending || added}
          >
            {isPending ? "Adding…" : added ? "Added ✓" : "Add to Cart"}
          </Button>
        </>
      )}
    </div>
  );
}
