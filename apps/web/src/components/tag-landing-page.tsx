import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCropBySlug,
  getPestDiseaseBySlug,
  getCustomerCatalogue,
  getDealerCatalogue,
  resolveCustomerCatalogueStateId,
} from "@kisan4u/catalog";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { EmptyState, PageContainer, PageHeader } from "@kisan4u/ui";
import { auth } from "@/auth";
import { MiniProductCard } from "@/components/homepage/mini-product-card";
import { ProductGrid } from "@/components/product-grid";
import { adaptCustomerProduct, adaptDealerProduct } from "@/lib/product-card-adapter";
import { getCardContext } from "@/lib/card-context";
import { ShareButton } from "@/components/share-button";
import { absoluteSiteUrl } from "@/lib/site-origin";

/**
 * Homepage redesign, phase B (#5/#6) — the audience-aware landing page
 * behind a "Shop by Crop" / "Shop by Pest & Disease" strip entry. One
 * route each (`/crops/[slug]`, `/pest-disease/[slug]`); the page itself
 * detects an APPROVED dealer session and shows dealer pricing/cards,
 * everyone else sees the customer catalogue — the same split
 * apps/web/src/app/products vs .../dealer/products make, kept in one place
 * here since the only difference between the two tag pages is which master
 * the slug resolves against.
 */
export async function TagLandingPage({ kind, slug }: { kind: "crop" | "pest"; slug: string }) {
  const tag = kind === "crop" ? await getCropBySlug(slug) : await getPestDiseaseBySlug(slug);
  if (!tag) notFound();

  const session = await auth();
  const isDealer =
    session?.user.role === "DEALER" &&
    (await getDealerProfileForUser(session.user.id))?.status === "APPROVED";

  const filter = kind === "crop" ? { cropSlug: slug } : { pestDiseaseSlug: slug };

  let cards: React.ReactNode;
  let productIdsForContext: string[] = [];

  if (isDealer) {
    const dealerProfile = await getDealerProfileForUser(session!.user.id);
    const products = await getDealerCatalogue(dealerProfile?.stateId ?? null, filter);
    productIdsForContext = products.map((p) => p.id);
    const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
      session!.user.id,
      productIdsForContext,
    );
    cards =
      products.length === 0 ? null : (
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
      );
  } else {
    const customerStateId =
      session?.user.role === "CUSTOMER"
        ? await resolveCustomerCatalogueStateId(session.user.id)
        : undefined;
    const products = await getCustomerCatalogue({ ...filter, customerStateId });
    productIdsForContext = products.map((p) => p.id);
    const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
      session?.user.id ?? null,
      productIdsForContext,
    );
    cards =
      products.length === 0 ? null : (
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
      );
  }

  const backHref = "/";
  const label = kind === "crop" ? "crop" : "pest or disease";
  const heading = tag.emoji && !tag.imageUrl ? `${tag.emoji}  ${tag.name}` : tag.name;

  return (
    <PageContainer maxWidth="1400px" className="py-8">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title={heading}
          description={
            kind === "crop"
              ? `Seeds, nutrition, crop protection and equipment for ${tag.name}.`
              : `Products to prevent and treat ${tag.name}.`
          }
        />
        <ShareButton
          url={await absoluteSiteUrl(
            `/${kind === "crop" ? "crops" : "pest-disease"}/${encodeURIComponent(slug)}`,
          )}
          title={tag.name}
        />
      </div>

      {cards ?? (
        <EmptyState
          title={`No products for this ${label} yet`}
          description="Nothing is tagged here right now — check back soon."
          action={
            <Link href={backHref} className="text-sm font-bold text-green-700 hover:underline">
              Back to home
            </Link>
          }
        />
      )}
    </PageContainer>
  );
}
