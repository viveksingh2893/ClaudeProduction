import { prisma } from "@kisan4u/db";
import {
  getActiveLogisticsConfig,
  toShippingConfigInput,
  getCropPestReferenceData,
} from "@kisan4u/catalog";
import { resolveNetPayableSellerRates } from "@kisan4u/orders";
import type { ReferenceData } from "@/components/product-form";

/**
 * Admin sees every APPROVED brand/manufacturer regardless of owner —
 * unlike the seller-scoped loader in seller/products/reference-data.ts.
 * `sellerId` is the owning seller of the product being edited — passed so
 * the "Net payable" price mode can resolve that seller's commission rate
 * for the live preview; omitted (no settlement preview) when unknown.
 */
export async function loadAdminReferenceData(sellerId?: string | null): Promise<ReferenceData> {
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
    editorialBadges,
  ] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.subSubCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } }),
    prisma.manufacturer.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } }),
    prisma.productAttribute.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getCropPestReferenceData(),
    getActiveLogisticsConfig(),
    // Admin only editable field — fetched here (not for the seller loader)
    // since only the admin form ever renders this dropdown. Every badge
    // (active or not) is fetched — ProductForm itself filters to active
    // ones for a NEW selection while still showing an already-assigned
    // inactive badge as the current value (spec: "existing assignments
    // must continue to load correctly while editing").
    prisma.editorialBadge.findMany({ orderBy: { position: "asc" } }),
  ]);
  const settlementPricing = sellerId ? await resolveNetPayableSellerRates(sellerId) : null;

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
    editorialBadges,
  };
}
