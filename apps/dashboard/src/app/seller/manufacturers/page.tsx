import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { SellerBrandManufacturerManager } from "@/components/seller-brand-manufacturer-manager";
import { createManufacturerRequestAction, updateManufacturerRequestAction } from "./actions";

export default async function SellerManufacturersPage() {
  const { sellerProfileId } = await requireApprovedSeller();
  const manufacturers = await prisma.manufacturer.findMany({
    where: { ownerSellerId: sellerProfileId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <PageContainer maxWidth="1100px" className="py-8">
      <PageHeader
        title="Manufacturer requests"
        description="Submit a new manufacturer for admin approval. Once approved, it's yours to use on your own products — no other seller can select it."
      />
      <SellerBrandManufacturerManager
        label="Manufacturer"
        items={manufacturers}
        onCreate={createManufacturerRequestAction}
        onUpdate={updateManufacturerRequestAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
