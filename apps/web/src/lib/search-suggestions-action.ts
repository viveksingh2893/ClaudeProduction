"use server";

import {
  searchCustomerCatalogueForPos,
  searchDealerCatalogueForPos,
  adaptCustomerProduct,
  adaptDealerProduct,
  type ProductCardData,
} from "@kisan4u/catalog";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { auth } from "@/auth";
import { getCardContext } from "./card-context";

const SUGGESTION_LIMIT = 5;
const MIN_QUERY = 2;

/**
 * Top few product matches for the header search dropdown. Audience is
 * resolved from the live session (customer vs approved dealer) exactly
 * like loadCatalogueProductsPage — never trusted from the client — so
 * pricing on each card is right for the viewer. Name match is
 * case-insensitive substring on name / SKU (same as POS search).
 */
export async function searchProductSuggestions(rawQuery: string): Promise<ProductCardData[]> {
  const q = rawQuery.trim();
  if (q.length < MIN_QUERY) return [];

  const session = await auth();
  const userId = session?.user.id ?? null;

  if (session?.user.role === "DEALER") {
    const profile = await getDealerProfileForUser(session.user.id);
    if (!profile || profile.status !== "APPROVED") return [];
    const { rows } = await searchDealerCatalogueForPos(profile.stateId, {
      search: q,
      page: 1,
      pageSize: SUGGESTION_LIMIT,
    });
    const { ratingThreshold, wishlistedIds, language } = await getCardContext(
      userId,
      rows.map((p) => p.id),
    );
    return rows.map((p) =>
      adaptDealerProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }),
    );
  }

  const { rows } = await searchCustomerCatalogueForPos({
    search: q,
    page: 1,
    pageSize: SUGGESTION_LIMIT,
  });
  const { ratingThreshold, wishlistedIds, language } = await getCardContext(
    userId,
    rows.map((p) => p.id),
  );
  return rows.map((p) =>
    adaptCustomerProduct(p, { ratingThreshold, wishlisted: wishlistedIds.has(p.id), language }),
  );
}
