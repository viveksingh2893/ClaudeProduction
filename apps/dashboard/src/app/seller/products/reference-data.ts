import { prisma } from "@kisan4u/db";
import {
  getActiveLogisticsConfig,
  toShippingConfigInput,
  getCropPestReferenceData,
} from "@kisan4u/catalog";
import { resolveNetPayableSellerRates } from "@kisan4u/orders";
import type { ReferenceData } from "@/components/product-form";

/**
 * Shared reference-data fetch for the seller product form. Brands and
 * manufacturers are scoped to what this exact seller is allowed to pick:
 * APPROVED and either global (ownerSellerId null) or owned by this same
 * seller — never another seller's private, approved entry. The server
 * re-checks this same rule again at save time (see
 * packages/catalog/src/product-submission.ts assertBrandUsable/
 * assertManufacturerUsable) since the dropdown options alone are not a
 * security boundary.
 */
export async function loadReferenceData(sellerId: string): Promise<ReferenceData> {
  const ownerFilter = {
    status: "APPROVED" as const,
    OR: [{ ownerSellerId: null }, { ownerSellerId: sellerId }],
  };
  const [
    categories,
    subcategories,
    subSubCategories,
    brands,
    manufacturers,
    attributes,
    states,
    cropPest,
    logisticsConfig,
  ] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.subSubCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: ownerFilter, orderBy: { name: "asc" } }),
    prisma.manufacturer.findMany({ where: ownerFilter, orderBy: { name: "asc" } }),
    prisma.productAttribute.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getCropPestReferenceData(),
    getActiveLogisticsConfig(),
  ]);
  const settlementPricing = await resolveNetPayableSellerRates(sellerId);

  return {
    categories,
    subcategories,
    subSubCategories,
    brands,
    manufacturers,
    attributes,
    states,
    crops: cropPest.crops,
    pestsDiseases: cropPest.pestsDiseases,
    logisticsConfig: toShippingConfigInput(logisticsConfig),
    settlementPricing,
    // Admin-only field (spec) — sellers never see or select a badge, so
    // there's nothing to fetch here; ProductForm hides the control entirely
    // when isAdmin is false.
    editorialBadges: [],
  };
}
