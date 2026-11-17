import { NextRequest } from "next/server";
import { getDealerCatalogue, redactDealerPricingIfUnavailable } from "@kisan4u/catalog";
import {
  jsonOk,
  parsePagination,
  requireMobileApprovedDealer,
  withMobileApi,
} from "@/lib/mobile-api";

/** Dealer bulk catalogue — dealer pricing/MOQ, DEALER-only, matching apps/web/src/app/dealer/products/page.tsx. Category/brand/search filtering happens here (getDealerCatalogue itself is deliberately unfiltered). */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const dealer = await requireMobileApprovedDealer(req);
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const subCategory = url.searchParams.get("subCategory") ?? undefined;
    const subSubCategory = url.searchParams.get("subSubCategory") ?? undefined;
    const brand = url.searchParams.get("brand") ?? undefined;
    const crop = url.searchParams.get("crop") ?? undefined;
    const pest = url.searchParams.get("pest") ?? undefined;
    const q = url.searchParams.get("q")?.trim().toLowerCase();
    const { page, pageSize } = parsePagination(url);

    const all = await getDealerCatalogue(dealer.dealerStateId, { cropSlug: crop, pestDiseaseSlug: pest });
    const filtered = all
      .filter((p) => !category || p.category.slug === category)
      .filter((p) => !subCategory || p.subCategory?.slug === subCategory)
      .filter((p) => !subSubCategory || p.subSubCategory?.slug === subSubCategory)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .filter((p) => !brand || p.brand?.slug === brand);

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    // Redact dealer price fields for any product not available in this
    // dealer's own verified state — this is a JSON API response, not a
    // server-rendered page, so there's no boundary stopping restricted
    // price data from reaching the client other than doing it explicitly
    // here (see packages/catalog/src/availability.ts redactDealerPricingIfUnavailable).
    const items = filtered.slice(start, start + pageSize).map(redactDealerPricingIfUnavailable);
    return jsonOk({ items, page, pageSize, total, hasMore: start + items.length < total });
  });
}
