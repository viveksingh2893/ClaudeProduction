"use server";

import {
  getCustomerCataloguePage,
  getDealerCataloguePage,
  adaptCustomerProduct,
  adaptDealerProduct,
  resolveCustomerCatalogueStateId,
  type ProductCardData,
} from "@kisan4u/catalog";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { auth } from "@/auth";
import { getCardContext } from "./card-context";
import { CATALOGUE_PAGE_SIZE, type CatalogueTaxonomy } from "./catalogue-page";

/**
 * "Load the next page" for the infinite-scroll product grid on the
 * category / sub-category / sub-sub-category pages. Audience is resolved
 * from the live session here — never trusted from the client: a customer
 * gets customer pricing, an APPROVED dealer gets dealer pricing + their
 * state's availability, anyone else gets the guest (customer) catalogue.
 */
export async function loadCatalogueProductsPage(
  taxonomy: CatalogueTaxonomy,
  page: number,
): Promise<{ cards: ProductCardData[]; hasMore: boolean }> {
  const session = await auth();
  const safePage = Math.max(1, Math.trunc(page));

  const userId = session?.user.id ?? null;

  if (session?.user.role === "DEALER") {
    const profile = await getDealerProfileForUser(session.user.id);
    if (!profile || profile.status !== "APPROVED") return { cards: [], hasMore: false };
    const { rows, hasMore } = await getDealerCataloguePage({
      categorySlug: taxonomy.categorySlug,
      subCategorySlug: taxonomy.subCategorySlug,
      subSubCategorySlug: taxonomy.subSubCategorySlug,
      dealerStateId: profile.stateId,
      page: safePage,
      pageSize: CATALOGUE_PAGE_SIZE,
    });
    const { ratingThreshold, wishlistedIds, language } = await getCardContext(
      userId,
      rows.map((p) => p.id),
    );
    return {
      cards: rows.map((p) =>
        adaptDealerProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }),
      ),
      hasMore,
    };
  }

  const customerStateId =
    session?.user.role === "CUSTOMER"
      ? await resolveCustomerCatalogueStateId(session.user.id)
      : undefined;

  const { rows, hasMore } = await getCustomerCataloguePage({
    categorySlug: taxonomy.categorySlug,
    subCategorySlug: taxonomy.subCategorySlug,
    subSubCategorySlug: taxonomy.subSubCategorySlug,
    customerStateId,
    page: safePage,
    pageSize: CATALOGUE_PAGE_SIZE,
  });
  const { ratingThreshold, wishlistedIds, language } = await getCardContext(
    userId,
    rows.map((p) => p.id),
  );

  return {
    cards: rows.map((p) =>
      adaptCustomerProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }),
    ),
    hasMore,
  };
}
