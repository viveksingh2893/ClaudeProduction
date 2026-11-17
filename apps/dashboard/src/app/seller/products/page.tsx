import type { ProductLifecycleStatus } from "@kisan4u/db";
import { prisma } from "@kisan4u/db";
import { getSellerProductsPaginated } from "@kisan4u/catalog";
import { PageContainer, PageHeader, LinkButton } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { productPriceRange } from "@/lib/product-price-range";
import { SellerProductsTable } from "./seller-products-table";

const STATUS_VALUES: ProductLifecycleStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "INACTIVE",
];

export default async function SellerProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = STATUS_VALUES.includes(sp.status as ProductLifecycleStatus)
    ? (sp.status as ProductLifecycleStatus)
    : undefined;

  const [{ rows: products, total }, categories] = await Promise.all([
    getSellerProductsPaginated(sellerProfileId, {
      status,
      categoryId: sp.category || undefined,
      q: sp.q,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Product/ProductCustomerConfig/ProductDealerConfig carry Decimal columns
  // (mrp, sellingPrice, ...) that aren't plain-serializable across the
  // Server -> Client boundary — see the same fix in admin/orders/page.tsx.
  // Trim to what SellerProductsTable renders. A product only ever has a
  // customerConfig, only a dealerConfig, or both depending on audience — this
  // picks whichever is present, preferring customerConfig, for one "price"/
  // "stock" pair per row.
  const rows = products.map((p) => {
    const config = p.customerConfig ?? p.dealerConfig;
    const priceRange = productPriceRange(p);
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      primaryImageUrl: resolveStorefrontAssetUrl(p.primaryImageUrl) ?? "",
      category: { name: p.category.name },
      lifecycleStatus: p.lifecycleStatus,
      priceMin: priceRange?.min ?? null,
      priceMax: priceRange?.max ?? null,
      currentStock: config ? config.currentStock : null,
    };
  });

  return (
    <PageContainer maxWidth="1300px" className="py-8">
      <PageHeader
        title="My products"
        actions={<LinkButton href="/seller/products/new">+ New product</LinkButton>}
      />
      <SellerProductsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        categories={categories}
      />
    </PageContainer>
  );
}
