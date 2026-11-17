import { NextRequest } from "next/server";
import {
  getCustomerCatalogue,
  getPublicProductBySlug,
  getPublicReviewsForProduct,
  checkReviewEligibility,
  getCustomerReviewForProduct,
  getWishlistedProductIds,
  getProductAudienceInfoBySlug,
  resolveCustomerCatalogueStateId,
  resolveProductContent,
} from "@kisan4u/catalog";
import { toDbLanguage } from "@kisan4u/validators";
import { jsonError, jsonOk, optionalMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * Public product detail — same data/eligibility as
 * apps/web/src/app/products/[slug]/page.tsx (always customer/customer
 * pricing — dealer pricing lives at a separate endpoint,
 * /api/mobile/v1/dealer/products/[id]). ANY dealer-role caller (approved
 * or still pending) is rejected before getPublicProductBySlug (customer
 * pricing) is ever queried — mirrors the website's server-side redirect,
 * which redirects on role alone, not approval status (a pending dealer
 * still must never see customer pricing here). There's no page navigation
 * on an API route, so this is a 403 pointing the client at the right
 * endpoint instead. Deliberately NOT resolveCatalogViewer, which treats a
 * non-approved dealer as "CUSTOMER" audience — that's the right call for
 * the mixed homepage feed it was built for, but wrong here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return withMobileApi(async () => {
    const auth = await optionalMobileAuth(req);
    const { slug } = await params;
    if (auth?.role === "DEALER") {
      const info = await getProductAudienceInfoBySlug(slug);
      if (!info) return jsonError(404, "NOT_FOUND", "Product not found.");
      const dealerConfigured =
        info.dealerVisible &&
        (info.audience === "DEALER_ONLY" || info.audience === "BOTH_CUSTOMER_AND_DEALER");
      return jsonError(
        403,
        "WRONG_CATALOGUE",
        "Use /dealer/products/{id} for the dealer catalogue.",
        {
          redirect: dealerConfigured
            ? { type: "dealer-product", id: info.id }
            : { type: "unavailable" },
        },
      );
    }

    // Optional ?lang= — localize the product's own text (name + the six
    // description fields) exactly like apps/web/src/app/products/[slug]/page.tsx
    // does via resolveProductContent; defaults to EN when absent/unknown.
    const language = toDbLanguage(req.nextUrl.searchParams.get("lang"));
    // A DEALER caller was already rejected above.
    const isBuyer = auth && auth.role === "CUSTOMER";
    const customerStateId = isBuyer
      ? await resolveCustomerCatalogueStateId(auth.userId)
      : undefined;

    const product = await getPublicProductBySlug(slug, customerStateId);
    if (!product) return jsonError(404, "NOT_FOUND", "Product not found.");

    const [similarAll, { rows: reviews }, eligibility, myReview, wishlistedIds] = await Promise.all(
      [
        getCustomerCatalogue({ categorySlug: product.category.slug, customerStateId }),
        getPublicReviewsForProduct(product.id, { page: 1, pageSize: 20 }),
        isBuyer ? checkReviewEligibility(auth.userId, product.id) : Promise.resolve(null),
        isBuyer ? getCustomerReviewForProduct(auth.userId, product.id) : Promise.resolve(null),
        auth
          ? getWishlistedProductIds(auth.userId, [product.id])
          : Promise.resolve(new Set<string>()),
      ],
    );

    const similar = similarAll.filter((p) => p.id !== product.id).slice(0, 8);

    const localized = resolveProductContent(product, language);

    return jsonOk({
      product: { ...product, ...localized },
      isWishlisted: wishlistedIds.has(product.id),
      similar,
      reviews: {
        rows: reviews,
        canReview: !!eligibility?.eligible,
        ineligibleReason: eligibility && !eligibility.eligible ? eligibility.reason : null,
        myReview,
      },
    });
  });
}
