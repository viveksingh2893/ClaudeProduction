import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { SellerBrandManufacturerManager } from "@/components/seller-brand-manufacturer-manager";
import { createBrandRequestAction, updateBrandRequestAction } from "./actions";

export default async function SellerBrandsPage() {
  const { sellerProfileId } = await requireApprovedSeller();
  const brands = await prisma.brand.findMany({
    where: { ownerSellerId: sellerProfileId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <PageContainer maxWidth="1100px" className="py-8">
      <PageHeader
        title="Brand requests"
        description="Submit a new brand for admin approval. Once approved, it's yours to use on your own products — no other seller can select it."
      />
      <SellerBrandManufacturerManager
        label="Brand"
        items={brands}
        onCreate={createBrandRequestAction}
        onUpdate={updateBrandRequestAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
