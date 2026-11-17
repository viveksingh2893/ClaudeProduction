import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getFullName } from "@kisan4u/db";
import {
  getCustomerCatalogue,
  getPublicProductBySlug,
  getProductAudienceInfoBySlug,
  getPublicReviewsForProduct,
  checkReviewEligibility,
  getCustomerReviewForProduct,
  resolveCustomerCatalogueStateId,
  getRestockSubscriptionStatusesForProduct,
  resolveProductContent,
  resolveProductName,
} from "@kisan4u/catalog";
import { Breadcrumbs, PageContainer } from "@kisan4u/ui";
import { sanitizeProductRichText, htmlToPlainTextExcerpt } from "@kisan4u/validators";
import { auth } from "@/auth";
import { getT, getDbLanguage } from "@/i18n/server";
import { ProductDetailTabs } from "@/components/product-detail-tabs";
import { ProductPurchasePanel } from "@/components/product-purchase-panel";
import { ProductReviews } from "@/components/product-reviews";
import { SimilarProductsRow } from "@/components/similar-products-row";
import { InfiniteProductGrid } from "@/components/homepage/infinite-product-grid";
import { adaptCustomerProduct } from "@/lib/product-card-adapter";
import { getCardContext } from "@/lib/card-context";
import { loadFirstCataloguePage } from "@/lib/catalogue-first-page";
import { submitReviewAction } from "./review-actions";
import { ProductUnavailableForDealer } from "@/components/product-unavailable-for-dealer";
import { ProductShareButton } from "@/components/product-share-button";
import { absoluteSiteUrl } from "@/lib/site-origin";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProductBySlug(slug);
  if (!product) return {};

  const localizedName = resolveProductName(product, await getDbLanguage());
  // SEO fields fall back to safe product-title/description defaults when
  // the seller/admin left them empty — never an empty <title> or blank
  // description.
  const title = product.metaTitle || localizedName;
  // Plain-text excerpt, never raw HTML — this string goes straight into
  // <meta name="description"> / OpenGraph, neither of which render markup.
  const description =
    product.metaDescription || htmlToPlainTextExcerpt(product.shortDescription, 160);
  const image = product.metaImageUrl || product.primaryImageUrl;

  return {
    title,
    description,
    alternates: product.canonicalUrl ? { canonical: product.canonicalUrl } : undefined,
    openGraph: { title, description, images: image ? [{ url: image }] : undefined },
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();

  // A signed-in dealer must never reach this page's customer pricing — checked
  // and redirected BEFORE getPublicProductBySlug (which includes
  // customer pricing) is ever called, via a minimal query that carries no
  // price data at all (see getProductAudienceInfoBySlug's doc comment).
  if (session?.user.role === "DEALER") {
    const info = await getProductAudienceInfoBySlug(slug);
    if (!info) notFound();
    const dealerConfigured =
      info.dealerVisible &&
      (info.audience === "DEALER_ONLY" || info.audience === "BOTH_CUSTOMER_AND_DEALER");
    if (dealerConfigured) redirect(`/dealer/products/${info.id}`);
    return <ProductUnavailableForDealer />;
  }

  const customerStateId =
    session?.user.role === "CUSTOMER"
      ? await resolveCustomerCatalogueStateId(session.user.id)
      : undefined;

  const product = await getPublicProductBySlug(slug, customerStateId);
  if (!product) notFound();

  // Resolve the translatable text (name + the six description fields) for
  // the viewer's language up front: a ProductTranslation row supplies any
  // field it has, the English value on the Product row fills the rest.
  const { t, dbLang } = await getT();
  const localized = resolveProductContent(product, dbLang);

  const galleryImages =
    product.images.length > 0
      ? product.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText }))
      : [{ id: "primary", url: product.primaryImageUrl, altText: localized.name }];

  // ProductVariant carries Decimal fields (mrp/sellingPrice) that aren't
  // plain-serializable across the Server -> Client boundary — see the
  // same fix pattern in apps/dashboard/src/app/admin/orders/page.tsx.
  const variants = product.variants.map((v) => ({
    id: v.id,
    isActive: v.isActive,
    stockQty: v.stockQty,
    sku: v.sku,
    mrp: v.mrp.toString(),
    sellingPrice: v.sellingPrice.toString(),
    minOrderQty: v.minOrderQty,
    imageUrl: v.imageUrl,
    imageAlt: v.imageAlt,
    images: v.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText })),
    videoUrl: v.videoUrl,
    loyaltyPoints: v.loyaltyPoints,
    attributeValues: v.values.map((val) => ({
      attributeId: val.attributeValue.attributeId,
      attributeName: val.attributeValue.attribute.name,
      valueId: val.attributeValue.id,
      value: val.attributeValue.value,
    })),
  }));
  const defaultVariantId = product.variants.find((v) => v.isDefault)?.id ?? null;

  // A DEALER session can never reach this line — redirected above — so
  // the only two viewer states this page ever actually renders are these.
  const viewerState = !session ? "GUEST" : "CUSTOMER";

  const restockStatuses =
    session?.user.role === "CUSTOMER"
      ? await getRestockSubscriptionStatusesForProduct(session.user.id, product.id, "CUSTOMER")
      : new Map<string, { status: "ACTIVE" | "FULFILLED"; subscriptionId: string }>();
  const restockByVariantId = Object.fromEntries(restockStatuses);

  // Description tabs — sanitized server-side here (not in the client
  // ProductDetailTabs component), re-sanitizing on top of what
  // product-submission.ts already did at save time (defense in depth, spec
  // item #1), and safe for content saved before this feature existed too.
  const tabs = [
    {
      key: "description",
      label: t("pdp.description"),
      content: sanitizeProductRichText(localized.description || localized.shortDescription),
    },
    localized.ingredients
      ? {
          key: "ingredients",
          label: t("pdp.ingredients"),
          content: sanitizeProductRichText(localized.ingredients),
        }
      : null,
    localized.howToUse
      ? {
          key: "howto",
          label: t("pdp.howToUse"),
          content: sanitizeProductRichText(localized.howToUse),
        }
      : null,
    localized.dosageInstructions
      ? {
          key: "dosage",
          label: t("pdp.dosage"),
          content: sanitizeProductRichText(localized.dosageInstructions),
        }
      : null,
  ].filter((tab): tab is { key: string; label: string; content: string } => tab !== null);

  // "Similar Products" carousel — same category, current product removed,
  // up to 12 for a proper peek-and-scroll row.
  const similar = (
    await getCustomerCatalogue({ categorySlug: product.category.slug, customerStateId })
  )
    .filter((p) => p.id !== product.id)
    .slice(0, 12);

  // "More products" infinite feed at the bottom — the same paginated
  // catalogue source the category pages use (real cursor-style pagination
  // in @kisan4u/catalog:getCustomerCataloguePage, not fetch-all-then-slice).
  const moreProductsPage = await loadFirstCataloguePage({ categorySlug: product.category.slug });

  const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
    session?.user.id ?? null,
    similar.map((p) => p.id),
  );

  const similarCards = similar.map((p) =>
    adaptCustomerProduct(p, {
      ratingThreshold,
      wishlisted: wishlistedIds.has(p.id),
      language,
    }),
  );

  // Don't show the current product or the "Similar" ones again in the
  // "More products" feed. The InfiniteProductGrid also drops these client-
  // side on later pages via excludeIds; this keeps the first paint clean.
  const excludeFromMore = new Set([product.id, ...similarCards.map((c) => c.id)]);
  const moreProducts = {
    ...moreProductsPage,
    cards: moreProductsPage.cards.filter((c) => !excludeFromMore.has(c.id)),
  };

  // A DEALER session never reaches this point (redirected above).
  const isBuyerRole = session && session.user.role === "CUSTOMER";
  const [{ rows: publicReviews }, eligibility, myReview] = await Promise.all([
    getPublicReviewsForProduct(product.id, { page: 1, pageSize: 20 }),
    isBuyerRole ? checkReviewEligibility(session.user.id, product.id) : Promise.resolve(null),
    isBuyerRole ? getCustomerReviewForProduct(session.user.id, product.id) : Promise.resolve(null),
  ]);

  const reviewRows = publicReviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    verifiedPurchase: r.verifiedPurchase,
    source: r.source,
    manualCustomerName: r.manualCustomerName,
    createdAt: r.createdAt,
    customerName: r.customer?.deletedAt
      ? "Kisan4U Users"
      : r.customer
        ? getFullName(r.customer)
        : null,
  }));

  return (
    <PageContainer maxWidth="1300px" className="py-6 pb-28 md:pb-24">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: product.category.name, href: `/c/${product.category.slug}` },
            { label: localized.name },
          ]}
        />
        <ProductShareButton
          url={await absoluteSiteUrl(`/products/${encodeURIComponent(product.slug)}`)}
          title={localized.name}
        />
      </div>

      <ProductPurchasePanel
        productId={product.id}
        productName={localized.name}
        sellerName={product.seller?.shopName ?? null}
        shortDescription={sanitizeProductRichText(localized.shortDescription)}
        images={galleryImages}
        productVideoUrl={product.videoUrl}
        variants={variants}
        defaultVariantId={defaultVariantId}
        basePrice={
          product.customerConfig
            ? {
                sellingPrice: product.customerConfig.sellingPrice.toString(),
                mrp: product.customerConfig.mrp.toString(),
              }
            : null
        }
        baseLoyaltyPoints={product.customerConfig?.loyaltyPoints ?? 0}
        baseStock={product.customerConfig?.currentStock ?? 0}
        viewerState={viewerState}
        audience="CUSTOMER"
        restockByVariantId={restockByVariantId}
        buyNowEnabled={siteSettings.buyNowEnabled}
      />

      <SimilarProductsRow cards={similarCards} wishlistEnabled={siteSettings.wishlistEnabled} />

      {tabs.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-lg font-bold tracking-tight text-ink">Product details</h2>
          <ProductDetailTabs tabs={tabs} />
        </div>
      )}

      <div className="mt-10 border-t border-border pt-10">
        <ProductReviews
          productId={product.id}
          onSubmit={submitReviewAction.bind(null, slug)}
          ratingAverage={product.ratingAverage ? Number(product.ratingAverage) : null}
          ratingCount={product.ratingCount}
          reviews={reviewRows}
          canReview={!!eligibility?.eligible}
          ineligibleReason={eligibility && !eligibility.eligible ? eligibility.reason : undefined}
          myReview={
            myReview
              ? { id: myReview.id, rating: myReview.rating, comment: myReview.comment }
              : null
          }
          isLoggedIn={!!isBuyerRole}
        />
      </div>

      {moreProducts.cards.length > 0 && (
        <div className="mt-12 border-t border-border pt-10">
          <h2 className="mb-4 text-lg font-bold tracking-tight text-ink">More products</h2>
          <InfiniteProductGrid
            taxonomy={{ categorySlug: product.category.slug }}
            initialCards={moreProducts.cards}
            initialHasMore={moreProducts.hasMore}
            wishlistEnabled={moreProducts.wishlistEnabled}
            excludeIds={[product.id, ...similarCards.map((c) => c.id)]}
          />
        </div>
      )}
    </PageContainer>
  );
}
