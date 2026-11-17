import type { ReactNode } from "react";
import { ProductImage } from "./ProductImage";

const SIZE_CLASS = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
} as const;

/**
 * The single shared order/order-item row renderer — every place an order
 * line is summarized (customer order history/detail, dealer order
 * history/detail, seller order list/detail, admin order list/detail,
 * checkout group detail, payment/confirmation summary, refund/return
 * summary) goes through this instead of re-implementing its own image +
 * name + variant + qty row. `imageUrl` must already be resolved through
 * the priority chain (variant snapshot -> product snapshot -> live
 * variant -> live product -> null) by the caller — see
 * packages/orders/src/order-item-image.ts's resolveOrderItemImageUrl(s) —
 * this component is purely presentational and never touches the database
 * itself, so it works the same in a Server Component or a Client
 * Component context.
 */
export function OrderItemSummary({
  imageUrl,
  name,
  variantLabel,
  sku,
  quantity,
  size = "md",
  trailing,
  className = "",
}: {
  imageUrl: string | null | undefined;
  name: string;
  variantLabel?: string | null;
  sku?: string | null;
  quantity?: number | null;
  size?: "sm" | "md" | "lg";
  /** Optional right-aligned slot (price, status badge, etc.) — keeps this component from needing to know about every caller's own extra column. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <div
        className={`shrink-0 overflow-hidden rounded-md bg-green-50 ${SIZE_CLASS[size]}`}
      >
        <ProductImage src={imageUrl} alt={name} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{name}</div>
        <div className="flex flex-wrap gap-x-2 text-xs text-gray-600">
          {variantLabel && <span>{variantLabel}</span>}
          {sku && <span>SKU {sku}</span>}
          {quantity != null && <span>Qty {quantity}</span>}
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
