import { prisma } from "@kisan4u/db";
import type { BulkReferenceData } from "@/components/bulk-products/types";

export async function loadAdminBulkReferenceData(): Promise<BulkReferenceData> {
  const [categories, subcategories, subSubCategories, brands, manufacturers, attributes, states, editorialBadges, sellers] =
    await Promise.all([
      prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.subcategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.subSubCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.brand.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } }),
      prisma.manufacturer.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } }),
      prisma.productAttribute.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.editorialBadge.findMany({ orderBy: { position: "asc" } }),
      prisma.sellerProfile.findMany({ where: { status: "APPROVED" }, orderBy: { shopName: "asc" } }),
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
    editorialBadges: editorialBadges.map((b) => ({ id: b.id, name: b.name, isActive: b.isActive })),
    sellers: sellers.map((s) => ({ id: s.id, name: s.shopName })),
  };
}
