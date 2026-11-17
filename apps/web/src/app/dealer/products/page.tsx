import Link from "next/link";
import { redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getDealerCatalogue } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { EmptyState, LinkButton, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { MiniProductCard } from "@/components/homepage/mini-product-card";
import { ProductGrid } from "@/components/product-grid";
import { adaptDealerProduct } from "@/lib/product-card-adapter";
import { getCardContext } from "@/lib/card-context";

/**
 * Dealer-only catalogue — requireSession(["DEALER"]) proves the session is
 * authenticated; the APPROVED check below (re-read fresh from the DB, same
 * pattern as apps/web/src/app/account/page.tsx and dealer/status/page.tsx)
 * is what actually gates a pending/rejected/suspended dealer away from
 * dealer data, since middleware alone can't see live status. Dealer state
 * is now always set at registration (or by an admin) — no self-service
 * "set my state" control exists here anymore (see requirement 7).
 *
 * Category/search are filtered here in the page, not in getDealerCatalogue
 * — that query is deliberately price-free and unfiltered-by-category; this
 * keeps the security-sensitive select in packages/catalog untouched.
 */
export default async function DealerProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; brand?: string }>;
}) {
  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile) redirect("/login");
  if (profile.status !== "APPROVED") redirect("/dealer/status");

  const { category, q, brand } = await searchParams;
  const [allProducts, categories] = await Promise.all([
    getDealerCatalogue(profile.stateId),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const search = q?.trim().toLowerCase();
  const products = allProducts
    .filter((p) => !category || p.category.slug === category)
    .filter((p) => !search || p.name.toLowerCase().includes(search))
    .filter((p) => !brand || p.brand?.slug === brand);

  const activeCategory = categories.find((c) => c.slug === category);

  const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
    session.user.id,
    products.map((p) => p.id),
  );

  return (
    <PageContainer maxWidth="1400px" className="py-8">
      <PageHeader
        title={activeCategory ? activeCategory.name : "Dealer Catalogue"}
        description="Products available for bulk purchase in your registered state."
        actions={
          <LinkButton href="/dealer/requests" variant="outline" size="sm">
            My Requests
          </LinkButton>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title="No products available"
          description="No dealer products match your filters right now — try clearing them, or check back soon."
          action={
            <Link
              href="/dealer/products"
              className="text-sm font-bold text-earth-700 hover:underline"
            >
              Clear filters
            </Link>
          }
        />
      ) : (
        <ProductGrid>
          {products.map((p) => (
            <MiniProductCard
              key={p.id}
              product={adaptDealerProduct(p, {
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
