import {
  computeStockStatus,
  getAdminProductQueue,
  getProductCatalogueSummary,
  getProductPlacementsMap,
  getProductCategoryRankMap,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import type { ProductLifecycleStatus, ProductAudience } from "@kisan4u/db";
import { AlertTriangle, Clock3, Home, Package, ShieldCheck } from "lucide-react";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { productPriceRange } from "@/lib/product-price-range";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { ProductsTable } from "./products-table";

const STATUS_VALUES: ProductLifecycleStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "INACTIVE",
];
const AUDIENCE_VALUES: ProductAudience[] = ["CUSTOMER_ONLY", "DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"];
const TAB_VALUES = new Set(["all", "APPROVED", "SUBMITTED", "DRAFT", "REJECTED", "stockAttention"]);

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const tab = TAB_VALUES.has(sp.tab ?? "") ? (sp.tab ?? "all") : "all";
  const status = STATUS_VALUES.includes(sp.status as ProductLifecycleStatus)
    ? (sp.status as ProductLifecycleStatus)
    : tab !== "all" && tab !== "stockAttention"
      ? (tab as ProductLifecycleStatus)
      : undefined;
  const audience = AUDIENCE_VALUES.includes(sp.audience as ProductAudience)
    ? (sp.audience as ProductAudience)
    : undefined;

  const [{ rows: products, total }, placements, categoryRanks, categories, summary, positionedIds] =
    await Promise.all([
      getAdminProductQueue({
        status,
        categoryId: sp.category || undefined,
        audience,
        stockAttention: tab === "stockAttention" ? true : undefined,
        q: sp.q,
        sortKey: sp.sort,
        sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
        page,
        pageSize,
      }),
      getProductPlacementsMap(),
      getProductCategoryRankMap(),
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getProductCatalogueSummary(),
      prisma.product.findMany({
        where: { featuredPosition: { not: null } },
        select: { id: true },
      }),
    ]);

  const notPositionedCount =
    summary.total -
    new Set([...positionedIds.map((p) => p.id), ...placements.keys(), ...categoryRanks.keys()]).size;

  // Product carries a Decimal (ratingAverage) that isn't plain-serializable
  // across the Server -> Client Component boundary — see the same fix in
  // admin/orders/page.tsx. Trim to what ProductsTable renders.
  const rows = products.map((p) => {
    const priceRange = productPriceRange(p);
    const placement = placements.get(p.id) ?? {};
    const units = [
      ...p.variants.map((v) => ({ qty: v.stockQty, min: v.minStockQty, reorder: v.reorderLevel })),
      ...(p.customerConfig
        ? [
            {
              qty: p.customerConfig.currentStock,
              min: p.customerConfig.minStockQty,
              reorder: p.customerConfig.reorderLevel,
            },
          ]
        : []),
      ...(p.dealerConfig
        ? [
            {
              qty: p.dealerConfig.currentStock,
              min: p.dealerConfig.minStockQty,
              reorder: p.dealerConfig.reorderLevel,
            },
          ]
        : []),
    ];
    const lowStockCount = units.filter(
      (u) => computeStockStatus(u.qty, u.min, u.reorder).status !== "IN_STOCK",
    ).length;
    const outOfStockCount = units.filter(
      (u) => computeStockStatus(u.qty, u.min, u.reorder).status === "OUT_OF_STOCK",
    ).length;
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      primaryImageUrl: resolveStorefrontAssetUrl(p.primaryImageUrl) ?? "",
      category: { name: p.category.name },
      seller: p.seller ? { shopName: p.seller.shopName } : null,
      lifecycleStatus: p.lifecycleStatus,
      audience: p.audience,
      priceMin: priceRange?.min ?? null,
      priceMax: priceRange?.max ?? null,
      variantCount: p.variants.length,
      lowStockCount,
      outOfStockCount,
      positioning: {
        featuredPosition: p.featuredPosition,
        trending: placement.TRENDING ?? null,
        bestSeller: placement.BEST_SELLERS ?? null,
        newArrival: placement.NEW_ARRIVALS ?? null,
        categoryRank: categoryRanks.get(p.id) ?? null,
      },
    };
  });

  function tabHref(tabKey: string) {
    const params = new URLSearchParams();
    if (tabKey !== "all") params.set("tab", tabKey);
    return params.toString() ? `/admin/products?${params.toString()}` : "/admin/products";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.total, href: tabHref("all") },
    { key: "APPROVED", label: "Live", count: summary.live, href: tabHref("APPROVED") },
    { key: "SUBMITTED", label: "Pending", count: summary.pending, href: tabHref("SUBMITTED") },
    { key: "DRAFT", label: "Draft", count: summary.draft, href: tabHref("DRAFT") },
    { key: "REJECTED", label: "Rejected", count: summary.rejected, href: tabHref("REJECTED") },
    {
      key: "stockAttention",
      label: "Stock Attention",
      count: summary.stockAttentionCount,
      href: tabHref("stockAttention"),
    },
  ];

  return (
    <PageContainer className="py-8" maxWidth="1400px">
      <PageHeader
        title="Products"
        description="Manage catalogue approval, pricing, stock, and storefront visibility."
      />

      <StatCardsRow>
        <StatCard icon={<Package className="h-5 w-5" aria-hidden="true" />} label="Total products" value={summary.total} hint="Across all sellers" />
        <StatCard
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          label="Live products"
          value={summary.live}
          hint={`${summary.total > 0 ? ((summary.live / summary.total) * 100).toFixed(1) : 0}% of catalogue`}
          tone="green"
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Pending approval"
          value={summary.pending}
          hint="Require review"
          tone="amber"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Stock attention"
          value={summary.stockAttentionCount}
          tone={summary.stockAttentionCount > 0 ? "red" : "neutral"}
        />
        <StatCard
          icon={<Home className="h-5 w-5" aria-hidden="true" />}
          label="Not positioned"
          value={notPositionedCount}
          hint="Not featured on homepage"
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.pending > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.pending} product${summary.pending === 1 ? "" : "s"} are waiting for approval`}
            href={tabHref("SUBMITTED")}
            linkLabel="Review pending"
          />
        )}
        {summary.stockAttentionCount > 0 && (
          <AlertBanner
            tone="red"
            title={`${summary.stockAttentionCount} product variant${summary.stockAttentionCount === 1 ? "" : "s"} need stock attention`}
            href="/admin/product-quantity"
            linkLabel="Open inventory"
          />
        )}
        {notPositionedCount > 0 && (
          <AlertBanner
            tone="blue"
            title={`${notPositionedCount} products are not assigned a storefront position`}
            href="/admin/homepage"
            linkLabel="Manage positioning"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />

      <ProductsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        categories={categories}
      />
    </PageContainer>
  );
}
