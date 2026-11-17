import type { Candidate } from "./types";
import { isDeletable } from "./types";
import {
  findCustomerCandidates,
  findDealerCandidates,
  findSellerCandidates,
  findProductCandidates,
  findProductsOwnedByTestSellers,
  findVariantCandidates,
  findVariantsOfProducts,
} from "./candidates";
import { analyzeUserDependencies, analyzeSellerDependencies, analyzeProductDependencies, analyzeVariantDependencies } from "./dependencies";
import { groupReport, type ReportGroups } from "./report";

export type DiscoveryResult = {
  groups: ReportGroups;
  allCandidates: Candidate[];
};

/**
 * The one entry point both the dry-run report and the manifest builder
 * call — always a fresh scan against the live database, never cached,
 * which is what makes the manifest's staleness check (diffManifestAgainstFresh)
 * meaningful.
 */
export async function runDiscovery(): Promise<DiscoveryResult> {
  const [customers, dealers, sellers] = await Promise.all([
    findCustomerCandidates(),
    findDealerCandidates(),
    findSellerCandidates(),
  ]);

  const testSellerIdSet = new Set(sellers.map((s) => s.id));

  await Promise.all([
    ...customers.map((c) => analyzeUserDependencies(c, testSellerIdSet)),
    ...dealers.map((c) => analyzeUserDependencies(c, testSellerIdSet)),
  ]);

  const sellerProductIds = new Map<string, string[]>();
  for (const s of sellers) {
    const { productIds } = await analyzeSellerDependencies(s);
    sellerProductIds.set(s.id, productIds);
  }

  const productsOwnedByTestSellers = await findProductsOwnedByTestSellers([...testSellerIdSet]);
  await Promise.all(productsOwnedByTestSellers.map((p) => analyzeProductDependencies(p)));

  // Cross-check: a test seller with ANY owned product that isn't itself
  // deletable (order history, etc.) is blocked from deletion too — it
  // would otherwise fail at apply time with a dangling Product row.
  for (const seller of sellers) {
    const ownedIds = new Set(sellerProductIds.get(seller.id) ?? []);
    const blockedOwnedProducts = productsOwnedByTestSellers.filter(
      (p) => ownedIds.has(p.id) && !isDeletable(p),
    );
    if (blockedOwnedProducts.length > 0) {
      seller.blockReasons.push(
        `Owns ${blockedOwnedProducts.length} product(s) that cannot themselves be auto-deleted (e.g. order history) — the seller can't be deleted while any of its products remain: ${blockedOwnedProducts
          .map((p) => p.name)
          .join(", ")}`,
      );
    }
  }

  const independentProducts = await findProductCandidates(testSellerIdSet);
  // De-duplicate: a product already covered by findProductsOwnedByTestSellers
  // (owned by a test seller) must not ALSO appear as an "independent" match
  // — same record, two competing paths (spec §9: "avoid deleting both a
  // parent record and the same dependent record through competing cleanup
  // paths").
  const ownedProductIds = new Set(productsOwnedByTestSellers.map((p) => p.id));
  const independentProductsDeduped = independentProducts.filter((p) => !ownedProductIds.has(p.id));
  await Promise.all(independentProductsDeduped.map((p) => analyzeProductDependencies(p)));

  // Variants: every variant of a product that's ITSELF in the deletable
  // product set (owned-by-test-seller or independent) is pulled in as a
  // dependent, deduplicated against variants independently matched by SKU.
  const allDeletableProductIds = [...productsOwnedByTestSellers, ...independentProductsDeduped]
    .filter(isDeletable)
    .map((p) => p.id);
  const variantsOfDeletableProducts = await findVariantsOfProducts(allDeletableProductIds);
  const independentVariants = await findVariantCandidates();
  await Promise.all(independentVariants.map((v) => analyzeVariantDependencies(v)));

  const coveredVariantIds = new Set(variantsOfDeletableProducts.map((v) => v.id));
  const independentVariantsDeduped = independentVariants.filter((v) => !coveredVariantIds.has(v.id));

  const variants = [...variantsOfDeletableProducts, ...independentVariantsDeduped];

  const groups = groupReport({
    customers,
    dealers,
    sellers,
    productsOwnedByTestSellers,
    independentProducts: independentProductsDeduped,
    variants,
  });

  const allCandidates = [
    ...customers,
    ...dealers,
    ...sellers,
    ...productsOwnedByTestSellers,
    ...independentProductsDeduped,
    ...variants,
  ];

  return { groups, allCandidates };
}
