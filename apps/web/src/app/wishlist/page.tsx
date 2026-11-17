import { getWishlistedProducts, resolveCustomerCatalogueStateId } from "@kisan4u/catalog";
import { PageContainer, PageHeader, EmptyState } from "@kisan4u/ui";
import { requireBuyerContext } from "@/lib/buyer-context";
import { MiniProductCard } from "@/components/homepage/mini-product-card";
import { ProductGrid } from "@/components/product-grid";
import { adaptHomepageProduct } from "@/lib/product-card-adapter";
import { getCardContext } from "@/lib/card-context";

export default async function WishlistPage() {
  const ctx = await requireBuyerContext();
  const audience = ctx.role === "DEALER" ? "DEALER" : "CUSTOMER";
  const customerStateId =
    ctx.role === "CUSTOMER" ? await resolveCustomerCatalogueStateId(ctx.userId) : undefined;
  const products = await getWishlistedProducts(
    ctx.userId,
    audience,
    ctx.dealerState?.id ?? null,
    customerStateId,
  );
  const { siteSettings, ratingThreshold, language } = await getCardContext(ctx.userId, []);

  return (
    <PageContainer maxWidth="1400px" className="py-8">
      <PageHeader title="My Wishlist" />
      {products.length === 0 ? (
        <EmptyState title="Your wishlist is empty" description="Tap the heart icon on any product to save it here." />
      ) : (
        <ProductGrid>
          {products.map((p) => (
            <MiniProductCard
              key={p.id}
              product={adaptHomepageProduct(p, { ratingThreshold, wishlisted: true, language })}
              wishlistEnabled={siteSettings.wishlistEnabled}
            />
          ))}
        </ProductGrid>
      )}
    </PageContainer>
  );
}
