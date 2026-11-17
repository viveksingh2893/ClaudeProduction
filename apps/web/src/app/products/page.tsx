import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomerCatalogue, resolveCustomerCatalogueStateId } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { EmptyState, PageContainer, PageHeader } from "@kisan4u/ui";
import { auth } from "@/auth";
import { MiniProductCard } from "@/components/homepage/mini-product-card";
import { ProductGrid } from "@/components/product-grid";
import { adaptCustomerProduct } from "@/lib/product-card-adapter";
import { getCardContext } from "@/lib/card-context";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    subCategory?: string;
    subSubCategory?: string;
    q?: string;
    brand?: string;
  }>;
}) {
  const { category, subCategory, subSubCategory, q, brand } = await searchParams;
  const session = await auth();

  // The customer catalogue must never be reachable by a signed-in dealer —
  // redirected server-side, before getCustomerCatalogue (customer pricing) is
  // ever fetched, never a client-side/CSS-only gate. Category is carried
  // over for a smoother landing; search/brand aren't, since the dealer
  // catalogue's own filters are a different product set entirely.
  if (session?.user.role === "DEALER") {
    redirect(category ? `/dealer/products?category=${category}` : "/dealer/products");
  }

  const customerStateId =
    session?.user.role === "CUSTOMER"
      ? await resolveCustomerCatalogueStateId(session.user.id)
      : undefined;

  const [allProducts, categories] = await Promise.all([
    getCustomerCatalogue({
      categorySlug: category,
      subCategorySlug: subCategory,
      subSubCategorySlug: subSubCategory,
      customerStateId,
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const search = q?.trim().toLowerCase();
  const products = allProducts
    .filter((p) => !search || p.name.toLowerCase().includes(search))
    .filter((p) => !brand || p.brand?.slug === brand);

  const activeCategory = categories.find((c) => c.slug === category);

  const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
    session?.user.id ?? null,
    products.map((p) => p.id),
  );

  return (
    <PageContainer maxWidth="1400px" className="py-8">
      <PageHeader
        title={activeCategory ? activeCategory.name : "All Products"}
        description={
          search
            ? `Search results for "${q}"`
            : "Seeds, fertilizers, equipment and more from verified sellers."
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title="No products found"
          description={
            search
              ? "Try a different search term."
              : "There are no products here yet."
          }
          action={
            <Link href="/products" className="text-sm font-bold text-green-700 hover:underline">
              Clear filters
            </Link>
          }
        />
      ) : (
        <ProductGrid>
          {products.map((p) => (
            <MiniProductCard
              key={p.id}
              product={adaptCustomerProduct(p, {
                ratingThreshold,
                wishlisted: wishlistedIds.has(p.id),
                language,
              })}
              wishlistEnabled={siteSettings.wishlistEnabled}
            />
          ))}
        </ProductGrid>
      )}
    </PageContainer>
  );
}
