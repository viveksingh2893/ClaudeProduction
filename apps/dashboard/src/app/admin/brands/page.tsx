import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BrandManufacturerManager } from "@/components/brand-manufacturer-manager";
import {
  createBrandAction,
  updateBrandAction,
  decideBrandAction,
  uploadBrandImageAction,
  setBrandHomepagePositionAction,
} from "./actions";

export default async function AdminBrandsPage() {
  await requireSession(["ADMIN"]);
  const brands = await prisma.brand.findMany({
    include: { ownerSeller: { select: { shopName: true } } },
    orderBy: [{ homepagePosition: "asc" }, { status: "asc" }, { name: "asc" }],
  });

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Brands"
        description={
          <>
            Sellers can submit their own brand requests from <code>/seller/brands</code> — they start PENDING here.
            Brands created directly on this page are global (usable by every seller) and immediately approved. Use
            the <strong>Homepage rank</strong> column to feature approved brands in the storefront&rsquo;s
            &ldquo;Shop by Brand&rdquo; rail (lower rank shows first).
          </>
        }
      />
      <BrandManufacturerManager
        label="Brand"
        items={brands.map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          imageUrl: b.imageUrl,
          status: b.status,
          rejectionReason: b.rejectionReason,
          ownerSellerId: b.ownerSellerId,
          ownerSellerName: b.ownerSeller?.shopName ?? null,
          homepagePosition: b.homepagePosition,
        }))}
        onCreate={createBrandAction}
        onUpdate={updateBrandAction}
        onDecide={decideBrandAction}
        onUploadImage={uploadBrandImageAction}
        hasHomepageRank
        onSetHomepageRank={setBrandHomepagePositionAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
