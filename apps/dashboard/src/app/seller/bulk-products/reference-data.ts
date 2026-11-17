import { prisma } from "@kisan4u/db";
import type { BulkReferenceData } from "@/components/bulk-products/types";

/** Same scoping rules as apps/dashboard/src/app/seller/products/reference-data.ts — brands/manufacturers limited to global + this seller's own approved ones. Sellers never see editorial badges (admin-only field). */
export async function loadSellerBulkReferenceData(sellerId: string): Promise<BulkReferenceData> {
  const ownerFilter = {
    status: "APPROVED" as const,
    OR: [{ ownerSellerId: null }, { ownerSellerId: sellerId }],
  };
  const [categories, subcategories, subSubCategories, brands, manufacturers, attributes, states] =
    await Promise.all([
      prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.subcategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.subSubCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.brand.findMany({ where: ownerFilter, orderBy: { name: "asc" } }),
      prisma.manufacturer.findMany({ where: ownerFilter, orderBy: { name: "asc" } }),
      prisma.productAttribute.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    ]);

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    subcategories: subcategories.map((s) => ({ id: s.id, name: s.name, categoryId: s.categoryId })),
    subSubCategories: subSubCategories.map((s) => ({
      id: s.id,
      name: s.name,
      subCategoryId: s.subCategoryId,
    })),
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    manufacturers: manufacturers.map((m) => ({ id: m.id, name: m.name })),
    attributes: attributes.map((a) => ({ id: a.id, name: a.name })),
    states: states.map((s) => ({ id: s.id, name: s.name })),
    editorialBadges: [],
    sellers: [],
  };
}
