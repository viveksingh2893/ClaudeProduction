import { NextRequest } from "next/server";
import {
  getCustomerCatalogue,
  resolveCustomerCatalogueStateId,
  resolveProductName,
} from "@kisan4u/catalog";
import { toDbLanguage } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  optionalMobileAuth,
  parsePagination,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Public customer/customer catalogue — same data source and filtering as
 * apps/web/src/app/products/page.tsx. Always customer/customer pricing —
 * the dealer bulk catalogue lives on a completely separate route
 * (/api/mobile/v1/dealer/products). ANY dealer-role caller (approved or
 * still pending) is rejected here before getCustomerCatalogue is ever
 * queried, mirroring the website's server-side redirect for
 * apps/web/src/app/products/page.tsx. Pagination is applied here since
 * the underlying query returns the full eligible set and a mobile client
 * needs bounded pages.
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const auth = await optionalMobileAuth(req);
    if (auth?.role === "DEALER") {
      return jsonError(403, "WRONG_CATALOGUE", "Use /dealer/products for the dealer catalogue.");
    }

    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const subCategory = url.searchParams.get("subCategory") ?? undefined;
    const subSubCategory = url.searchParams.get("subSubCategory") ?? undefined;
    const brand = url.searchParams.get("brand") ?? undefined;
    const crop = url.searchParams.get("crop") ?? undefined;
    const pest = url.searchParams.get("pest") ?? undefined;
    const q = url.searchParams.get("q")?.trim().toLowerCase();
    const language = toDbLanguage(url.searchParams.get("lang"));
    const { page, pageSize } = parsePagination(url);

    const customerStateId =
      auth?.role === "CUSTOMER" ? await resolveCustomerCatalogueStateId(auth.userId) : undefined;

    const all = await getCustomerCatalogue({
      categorySlug: category,
      subCategorySlug: subCategory,
      subSubCategorySlug: subSubCategory,
      cropSlug: crop,
      pestDiseaseSlug: pest,
      customerStateId,
    });

    const filtered = all
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .filter((p) => !brand || p.brand?.slug === brand);

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);
    // The mobile ProductCard shows `product.name` verbatim, so resolve the
    // viewer's language here (same as apps/web's card adapters).
    const items =
      language === "EN"
        ? pageItems
        : pageItems.map((p) => ({ ...p, name: resolveProductName(p, language) }));

    return jsonOk({ items, page, pageSize, total, hasMore: start + items.length < total });
  });
}
