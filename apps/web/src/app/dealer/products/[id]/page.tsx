import { notFound, redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getFullName } from "@kisan4u/db";
import {
  getDealerProductDetail,
  getCustomerProductById,
  getDealerCatalogue,
  getPublicReviewsForProduct,
  checkReviewEligibility,
  getCustomerReviewForProduct,
  getRestockSubscriptionStatusesForProduct,
  resolveProductContent,
} from "@kisan4u/catalog";
import { validateCartLine } from "@kisan4u/orders";
import { Breadcrumbs, PageContainer } from "@kisan4u/ui";
import { sanitizeProductRichText } from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";
import { auth } from "@/auth";
import { getT } from "@/i18n/server";
import {
  DealerPurchasePanel,
  type DealerLineEligibility,
} from "@/components/dealer-purchase-panel";
import type { PlainVariant } from "@kisan4u/ui";
import { ProductDetailTabs } from "@/components/product-detail-tabs";
import { ProductReviews } from "@/components/product-reviews";
import { SimilarProductsRow } from "@/components/similar-products-row";
import { InfiniteProductGrid } from "@/components/homepage/infinite-product-grid";
import { adaptDealerProduct } from "@/lib/product-card-adapter";
import { getCardContext } from "@/lib/card-context";
import { loadFirstCataloguePage } from "@/lib/catalogue-first-page";
import { submitDealerReviewAction } from "./review-actions";
import { ProductShareButton } from "@/components/product-share-button";
import { absoluteSiteUrl } from "@/lib/site-origin";

/**
 * Shares its visual design with the customer product page
 * (apps/web/src/app/products/[slug]/page.tsx) — same breadcrumbs, wide
 * sticky ProductGallery, attribute-button VariantPicker, fixed
 * StickyBuyBar, Similar Products ScrollRow, ProductDetailTabs
 * accordions, ProductReviews and the "More products" infinite grid (via
 * DealerPurchasePanel, which mirrors ProductPurchasePanel) — while keeping
 * dealer-specific business logic (eligibility, dealer pricing,
 * state-unavailable handling, Request This Product) entirely separate,
 * per the "shared design, separate business behaviour" requirement. The
 * category ribbon / mobile bottom nav are hidden on this route the same
 * way as the customer PDP (see category-nav.tsx / bottom-nav.tsx).
 *
 * Root-cause fix history (dealer add-to-cart): this page previously
 * always showed "Request Seller" and, for a product with variants,
 * offered NO purchase path at all — it predated packages/orders' cart/
 * pricing system. It now reuses validateCartLine (the single source of
 * truth cart/checkout already use — never a second, parallel eligibility
 * check) to decide, per purchasable unit (the base product when it has no
 * variants, or each variant individually), whether to show dealer price +
 * quantity + Add to Cart, or a specific reason, or Request This Product —
 * which only ever appears for the STATE_UNAVAILABLE reason. Every
 * variant's eligibility is computed here, server-side, up front — the
 * client-side VariantPicker only ever resolves WHICH variant is selected
 * from data already fetched; it never re-derives price or availability.
 */
export default async function DealerProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await auth();
  if (!viewer?.user || viewer.user.role !== "DEALER") {
    const customerProduct = await getCustomerProductById(id);
    if (customerProduct) redirect(`/products/${customerProduct.slug}`);
    redirect("/register/dealer");
  }

  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile) redirect("/login");
  if (profile.status !== "APPROVED") redirect("/dealer/status");

  const product = await getDealerProductDetail(id, profile.stateId);
  if (!product) notFound();

  // Per-language name + description fields for the viewer, English fallback.
  const { t, dbLang } = await getT();
  const localized = resolveProductContent(product, dbLang);

  const lineCtx = { role: "DEALER" as const, dealerStateId: profile.stateId };
  const hasVariants = product.variants.length > 0;

  const baseEligibility: DealerLineEligibility | null =
    !hasVariants && product.dealerConfig
      ? await validateCartLine(product.id, null, product.dealerConfig.minOrderQty, lineCtx)
      : null;

  const variantEligibilityList: DealerLineEligibility[] = hasVariants
    ? await Promise.all(
        product.variants.map((v) => validateCartLine(product.id, v.id, v.minOrderQty, lineCtx)),
      )
    : [];
  const variantEligibility: Record<string, DealerLineEligibility> = Object.fromEntries(
    product.variants.map((v, i) => [v.id, variantEligibilityList[i]!]),
  );

  const galleryImages =
    product.images.length > 0
      ? product.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText }))
      : [{ id: "primary", url: product.primaryImageUrl, altText: localized.name }];

  // ProductVariant carries Decimal fields (mrp/sellingPrice) that aren't
  // plain-serializable across the Server -> Client boundary — same fix
  // pattern as the customer page.
  const dealerVariants: PlainVariant[] = product.variants.map((v) => ({
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

  const restockStatuses = await getRestockSubscriptionStatusesForProduct(
    session.user.id,
    product.id,
    "DEALER",
  );
  const restockByVariantId = Object.fromEntries(restockStatuses);

  // Description tabs — sanitized server-side here (defense in depth on top
  // of what product-submission.ts already did at save time).
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
  // up to 12 for a proper peek-and-scroll row (matches the customer PDP).
  const allDealerProducts = await getDealerCatalogue(profile.stateId);
  const similar = allDealerProducts
    .filter((p) => p.id !== product.id && p.category.id === product.category.id)
    .slice(0, 12);

  // "More products" infinite feed at the bottom — the same paginated,
  // audience-aware catalogue source the customer PDP and the category
  // pages use (loadFirstCataloguePage / loadCatalogueProductsPage already
  // branch to dealer pricing from the live session, so nothing dealer-
  // specific is needed here).
  const moreProductsPage = await loadFirstCataloguePage({ categorySlug: product.category.slug });

  const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
    session.user.id,
    similar.map((p) => p.id),
  );

  const similarCards = similar.map((p) =>
    adaptDealerProduct(p, {
      ratingThreshold,
      wishlisted: wishlistedIds.has(p.id),
      language,
    }),
  );

  const excludeFromMore = new Set([product.id, ...similarCards.map((c) => c.id)]);
  const moreProducts = {
    ...moreProductsPage,
    cards: moreProductsPage.cards.filter((c) => !excludeFromMore.has(c.id)),
  };

  const [{ rows: publicReviews }, eligibility, myReview] = await Promise.all([
    getPublicReviewsForProduct(product.id, { page: 1, pageSize: 20 }),
    checkReviewEligibility(session.user.id, product.id),
    getCustomerReviewForProduct(session.user.id, product.id),
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
            { label: "Dealer Catalogue", href: "/dealer/products" },
            { label: localized.name },
          ]}
        />
        <ProductShareButton
          url={await absoluteSiteUrl(`/dealer/products/${encodeURIComponent(product.id)}`)}
          title={localized.name}
        />
      </div>

      <DealerPurchasePanel
        productId={product.id}
        productName={localized.name}
        sellerName={product.seller?.shopName ?? null}
        shortDescription={sanitizeProductRichText(localized.shortDescription)}
        images={galleryImages}
        productVideoUrl={product.videoUrl}
        variants={dealerVariants}
        defaultVariantId={defaultVariantId}
        baseEligibility={baseEligibility}
        baseConfig={
          product.dealerConfig
            ? {
                minOrderQty: product.dealerConfig.minOrderQty,
                mrp: Number(product.dealerConfig.mrp),
                sellingPrice: Number(product.dealerConfig.sellingPrice),
                loyaltyPoints: product.dealerConfig.loyaltyPoints,
              }
            : null
        }
        variantEligibility={variantEligibility}
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
          onSubmit={submitDealerReviewAction.bind(null, product.id)}
          ratingAverage={product.ratingAverage ? Number(product.ratingAverage) : null}
          ratingCount={product.ratingCount}
          reviews={reviewRows}
          canReview={eligibility.eligible}
          ineligibleReason={!eligibility.eligible ? eligibility.reason : undefined}
          myReview={
            myReview
              ? { id: myReview.id, rating: myReview.rating, comment: myReview.comment }
              : null
          }
          isLoggedIn
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
