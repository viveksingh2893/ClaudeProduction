import type { getProductForSellerEdit } from "@kisan4u/catalog";
import {
  normalizeAudienceSku,
  calculateSellingPrice,
  type AudienceSkuAudience,
} from "@kisan4u/validators";
import type { ProductFormInitial, VariantRow } from "@/components/product-form";

type FullProduct = NonNullable<Awaited<ReturnType<typeof getProductForSellerEdit>>>;
type FullVariant = FullProduct["variants"][number];

/**
 * Existing rows saved before the audience-SKU feature have a null
 * config-level sku (spec decision: never backfilled, see the migration's
 * doc comment) — this seeds the form with a suggested "-cus"/"-dea" value
 * derived from the product's own top-level sku so the field isn't blank,
 * without writing anything until the seller/admin actually re-saves.
 */
function suggestAudienceSku(
  existing: string | null,
  baseSku: string,
  audience: AudienceSkuAudience,
): string {
  if (existing) return existing;
  const suggestion = normalizeAudienceSku(baseSku, audience);
  return suggestion.ok ? suggestion.sku : baseSku;
}

/**
 * A variant product's base config carries no real price — its mrp /
 * sellingPrice are stored as 0. That 0 is the "Display on product card"
 * value, and the section itself treats blank as "fall back to the default
 * variant's price", so seed the field blank rather than a literal "0" that
 * reads as a ₹0 price. A non-variant product always has mrp > 0 here, so
 * this is a no-op for it.
 */
function zeroToBlank(value: number): string {
  return value > 0 ? String(value) : "";
}

function toVariantRow(v: FullVariant): VariantRow {
  return {
    id: v.id,
    attributeValueRefs: v.values.map((val) => ({
      attributeId: val.attributeValue.attributeId,
      slug: val.attributeValue.slug,
    })),
    sku: v.sku,
    hsnCode: v.hsnCode ?? "",
    mrp: String(v.mrp),
    // Seeds the "Selling price" input from whatever discount is already
    // saved (see VariantRow.sellingPrice's doc comment) — the form itself
    // never lets this drift out of sync with discountType/discountValue
    // again once edited, since toVariantInput derives them back from
    // mrp+sellingPrice on every save.
    sellingPrice: String(calculateSellingPrice(Number(v.mrp), v.discountType, Number(v.discountValue))),
    netPayableAmount: v.netPayableAmount?.toString() ?? "",
    discountType: v.discountType,
    discountValue: String(v.discountValue),
    minOrderQty: String(v.minOrderQty),
    stockQty: String(v.stockQty),
    minStockQty: String(v.minStockQty),
    reorderLevel: String(v.reorderLevel),
    loyaltyPoints: v.loyaltyPoints != null ? String(v.loyaltyPoints) : "0",
    height: v.height != null ? String(v.height) : "",
    breadth: v.breadth != null ? String(v.breadth) : "",
    length: v.length != null ? String(v.length) : "",
    weight: v.weight != null ? String(v.weight) : "",
    shippingCalcMode: v.shippingCalcMode,
    taxCalcMode: v.taxCalcMode,
    imageUrl: v.imageUrl ?? "",
    imageAlt: v.imageAlt ?? "",
    images: v.images.map((img) => ({
      id: img.id,
      url: img.url,
      altText: img.altText ?? "",
      position: img.position,
      isActive: img.isActive,
    })),
    videoUrl: v.videoUrl ?? "",
    isActive: v.isActive,
    isDefault: v.isDefault,
  };
}

/**
 * Shared by both the seller and admin edit pages (see
 * apps/dashboard/src/app/seller/products/[id]/page.tsx and
 * apps/dashboard/src/app/admin/products/[id]/edit/page.tsx) so the same
 * product row always maps to the exact same form state regardless of who's
 * editing it — only the save action and permission gate differ per role.
 */
export function buildProductFormInitial(product: FullProduct): ProductFormInitial {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    hsnCode: product.hsnCode,
    taxPercent: product.taxPercent.toString(),
    priceEntryMode: product.priceEntryMode,
    shortDescription: product.shortDescription,
    description: product.description,
    ingredients: product.ingredients ?? undefined,
    howToUse: product.howToUse ?? undefined,
    dosageInstructions: product.dosageInstructions ?? undefined,
    technicalInfo: product.technicalInfo ?? undefined,
    translations: Object.fromEntries(
      product.translations
        .filter((tr) => tr.language !== "EN")
        .map((tr) => [
          tr.language,
          {
            name: tr.name ?? "",
            shortDescription: tr.shortDescription ?? "",
            description: tr.description ?? "",
            ingredients: tr.ingredients ?? "",
            howToUse: tr.howToUse ?? "",
            dosageInstructions: tr.dosageInstructions ?? "",
            technicalInfo: tr.technicalInfo ?? "",
          },
        ]),
    ) as ProductFormInitial["translations"],
    productType: product.productType,
    baseUnit: product.baseUnit,
    packageSize: product.packageSize,
    searchTags: product.searchTags,
    featuredPosition: product.featuredPosition ?? undefined,
    categoryId: product.categoryId,
    subCategoryId: product.subCategoryId ?? undefined,
    subSubCategoryId: product.subSubCategoryId ?? undefined,
    brandId: product.brandId ?? undefined,
    manufacturerId: product.manufacturerId ?? undefined,
    audience: product.audience,
    customerVisible: product.customerVisible,
    dealerVisible: product.dealerVisible,
    customerConfig: product.customerConfig
      ? {
          sku: suggestAudienceSku(product.customerConfig.sku, product.sku, "CUSTOMER"),
          hsnCode: product.customerConfig.hsnCode ?? product.hsnCode,
          mrp: zeroToBlank(Number(product.customerConfig.mrp)),
          discountType: product.customerConfig.discountType,
          discountValue: product.customerConfig.discountValue.toString(),
          sellingPrice: zeroToBlank(
            calculateSellingPrice(
              Number(product.customerConfig.mrp),
              product.customerConfig.discountType,
              Number(product.customerConfig.discountValue),
            ),
          ),
          netPayableAmount: product.customerConfig.netPayableAmount?.toString() ?? "",
          minOrderQty: product.customerConfig.minOrderQty.toString(),
          currentStock: product.customerConfig.currentStock.toString(),
          minStockQty: product.customerConfig.minStockQty.toString(),
          reorderLevel: product.customerConfig.reorderLevel.toString(),
          loyaltyPoints: product.customerConfig.loyaltyPoints.toString(),
          height: product.customerConfig.height?.toString() ?? "",
          breadth: product.customerConfig.breadth?.toString() ?? "",
          length: product.customerConfig.length?.toString() ?? "",
          weight: product.customerConfig.weight?.toString() ?? "",
          shippingCalcMode: product.customerConfig.shippingCalcMode,
          taxCalcMode: product.customerConfig.taxCalcMode,
        }
      : undefined,
    dealerConfig: product.dealerConfig
      ? {
          sku: suggestAudienceSku(product.dealerConfig.sku, product.sku, "DEALER"),
          hsnCode: product.dealerConfig.hsnCode ?? product.hsnCode,
          mrp: zeroToBlank(Number(product.dealerConfig.mrp)),
          discountType: product.dealerConfig.discountType,
          discountValue: product.dealerConfig.discountValue.toString(),
          sellingPrice: zeroToBlank(
            calculateSellingPrice(
              Number(product.dealerConfig.mrp),
              product.dealerConfig.discountType,
              Number(product.dealerConfig.discountValue),
            ),
          ),
          netPayableAmount: product.dealerConfig.netPayableAmount?.toString() ?? "",
          minOrderQty: product.dealerConfig.minOrderQty.toString(),
          currentStock: product.dealerConfig.currentStock.toString(),
          minStockQty: product.dealerConfig.minStockQty.toString(),
          reorderLevel: product.dealerConfig.reorderLevel.toString(),
          loyaltyPoints: product.dealerConfig.loyaltyPoints.toString(),
          height: product.dealerConfig.height?.toString() ?? "",
          breadth: product.dealerConfig.breadth?.toString() ?? "",
          length: product.dealerConfig.length?.toString() ?? "",
          weight: product.dealerConfig.weight?.toString() ?? "",
          shippingCalcMode: product.dealerConfig.shippingCalcMode,
          taxCalcMode: product.dealerConfig.taxCalcMode,
        }
      : undefined,
    attributeValues: product.variantAttributeValues.map((v) => ({
      id: v.id,
      attributeId: v.attributeId,
      value: v.value,
      slug: v.slug,
      position: v.position,
      isActive: v.isActive,
    })),
    customerVariants: product.variants.filter((v) => v.audience === "CUSTOMER").map(toVariantRow),
    dealerVariants: product.variants.filter((v) => v.audience === "DEALER").map(toVariantRow),
    customerStateIds: product.customerAvailableStates.map((s) => s.id),
    dealerStateIds: product.dealerAvailableStates.map((s) => s.id),
    cropIds: product.crops.map((c) => c.id),
    pestDiseaseIds: product.pestsDiseases.map((p) => p.id),
    primaryImageUrl: product.primaryImageUrl,
    videoUrl: product.videoUrl ?? undefined,
    images: product.images.map((img) => ({
      id: img.id,
      url: img.url,
      altText: img.altText ?? "",
      position: img.position,
      isActive: img.isActive,
    })),
    metaTitle: product.metaTitle ?? undefined,
    metaDescription: product.metaDescription ?? undefined,
    metaImageUrl: product.metaImageUrl ?? undefined,
    subtitle: product.subtitle ?? undefined,
    editorialBadgeId: product.editorialBadgeId ?? "",
    deliveryBadgeEnabled: product.deliveryBadgeEnabled,
    deliveryBadgeText: product.deliveryBadgeText ?? undefined,
    availabilityBadgeMode: product.availabilityBadgeMode,
    availabilityBadgeText: product.availabilityBadgeText ?? undefined,
  };
}
