import Link from "next/link";
import { ProductImage } from "@kisan4u/ui";
import { WishlistButton } from "@/components/wishlist-button";
import { QuickAddButton } from "@/components/quick-add/quick-add-button";
import type { ProductCardData } from "@/lib/product-card-adapter";

/**
 * The site's one product card — used on the homepage rows, category pages,
 * the product catalogue, wishlist, dealer catalogue and tag pages. (The
 * older, larger card with inline Buy Now / Add to Cart buttons was removed
 * so every listing looks the same.) Shows the image (with a wishlist heart
 * at its top-right corner), a two-line title, a
 * "from ₹X per unit" price line (the lowest per-unit price across the
 * product's variants), and a "Select size" pill (the site's green outline
 * CTA style) that opens the quick-add popup. The whole tile sits inside a
 * very thin light-green outline to match the storefront theme.
 */
export function MiniProductCard({
  product,
  wishlistEnabled = false,
}: {
  product: ProductCardData;
  wishlistEnabled?: boolean;
}) {
  return (
    <div className="group rounded-xl border border-green-500/30 bg-surface p-2">
      <div className="relative overflow-hidden rounded-lg bg-neutral-100">
        <Link href={product.href} className="block">
          <div className="aspect-square w-full">
            <ProductImage
              src={product.imageUrls[0]}
              alt={product.name}
              loading="lazy"
              fallbackLabel={product.name}
            />
          </div>
        </Link>
        {wishlistEnabled && (
          <WishlistButton
            productId={product.id}
            initialWishlisted={product.wishlisted}
            className="absolute right-2 top-2 z-10"
          />
        )}
      </div>
      <Link href={product.href} className="mt-1.5 block">
        <div className="line-clamp-2 min-h-[34px] text-[13px] font-medium leading-tight text-ink group-hover:text-green-700">
          {product.name}
        </div>
      </Link>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <Link href={product.href} className="block min-w-0">
          <PriceLine pricing={product.pricing} />
        </Link>
        <QuickAddButton productId={product.id} productHref={product.href} />
      </div>
    </div>
  );
}

function PriceLine({ pricing }: { pricing: ProductCardData["pricing"] }) {
  if (pricing.kind === "CUSTOMER" || pricing.kind === "DEALER_PRICED") {
    const price = pricing.minUnitPrice > 0 ? pricing.minUnitPrice : pricing.sellingPrice;
    const showStrike = pricing.mrp > price;
    return (
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[15px] font-bold text-ink">
          ₹{Math.round(price).toLocaleString("en-IN")}
        </span>
        <span className="text-[10px] font-medium text-gray-500">per unit</span>
        {showStrike && (
          <span className="text-[11px] text-gray-400 line-through">
            ₹{Math.round(pricing.mrp).toLocaleString("en-IN")}
          </span>
        )}
      </div>
    );
  }
  return null;
}
