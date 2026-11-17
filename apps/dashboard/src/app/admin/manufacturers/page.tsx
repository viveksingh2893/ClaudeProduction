import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BrandManufacturerManager } from "@/components/brand-manufacturer-manager";
import {
  createManufacturerAction,
  updateManufacturerAction,
  decideManufacturerAction,
  uploadManufacturerImageAction,
} from "./actions";

export default async function AdminManufacturersPage() {
  await requireSession(["ADMIN"]);
  const manufacturers = await prisma.manufacturer.findMany({
    include: { ownerSeller: { select: { shopName: true } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Manufacturers"
        description={
          <>
            Sellers can submit their own manufacturer requests from{" "}
            <code>/seller/manufacturers</code> — they start PENDING here. Manufacturers created
            directly on this page are global (usable by every seller) and immediately approved.
          </>
        }
      />
      <BrandManufacturerManager
        label="Manufacturer"
        items={manufacturers.map((m) => ({
          id: m.id,
          name: m.name,
          slug: m.slug,
          imageUrl: m.imageUrl,
          status: m.status,
          rejectionReason: m.rejectionReason,
          ownerSellerId: m.ownerSellerId,
          ownerSellerName: m.ownerSeller?.shopName ?? null,
        }))}
        onCreate={createManufacturerAction}
        onUpdate={updateManufacturerAction}
        onDecide={decideManufacturerAction}
        onUploadImage={uploadManufacturerImageAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
