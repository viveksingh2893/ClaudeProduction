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

type Result = {
  cards: ProductCardData[];
  hasMore: boolean;
  isDealer: boolean;
  wishlistEnabled: boolean;
};

/**
 * Server-render the first page of the category / sub-category /
 * sub-sub-category product feed, audience-aware from the live session — an
 * APPROVED dealer gets dealer pricing + their state's availability,
 * everyone else the customer catalogue. Subsequent pages come through
 * loadCatalogueProductsPage (the server action), which repeats this
 * branch. Cards carry the viewer's real wishlist state; `wishlistEnabled`
 * says whether the heart control should render at all.
 */
export async function loadFirstCataloguePage(taxonomy: CatalogueTaxonomy): Promise<Result> {
  const session = await auth();
  const userId = session?.user.id ?? null;

  if (session?.user.role === "DEALER") {
    const profile = await getDealerProfileForUser(session.user.id);
    if (profile?.status === "APPROVED") {
      const { rows, hasMore } = await getDealerCataloguePage({
        ...taxonomy,
        dealerStateId: profile.stateId,
        page: 1,
        pageSize: CATALOGUE_PAGE_SIZE,
      });
      const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
        userId,
        rows.map((p) => p.id),
      );
      return {
        cards: rows.map((p) =>
          adaptDealerProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }),
        ),
        hasMore,
        isDealer: true,
        wishlistEnabled: siteSettings.wishlistEnabled,
      };
    }
  }

  const customerStateId =
    session?.user.role === "CUSTOMER"
      ? await resolveCustomerCatalogueStateId(session.user.id)
      : undefined;
  const { rows, hasMore } = await getCustomerCataloguePage({
    ...taxonomy,
    customerStateId,
    page: 1,
    pageSize: CATALOGUE_PAGE_SIZE,
  });
  const { siteSettings, ratingThreshold, wishlistedIds, language } = await getCardContext(
    userId,
    rows.map((p) => p.id),
  );
  return {
    cards: rows.map((p) =>
      adaptCustomerProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }),
    ),
    hasMore,
    isDealer: false,
    wishlistEnabled: siteSettings.wishlistEnabled,
  };
}
