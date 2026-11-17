import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  createAttributeAction,
  updateAttributeAction,
  toggleAttributeActiveAction,
} from "./actions";

export default async function AdminAttributesPage() {
  await requireSession(["ADMIN"]);
  const attributes = await prisma.productAttribute.findMany({ orderBy: { name: "asc" } });

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <PageHeader
        title="Product attributes"
        description={
          <>
            An attribute defines only a NAME (Size, Color, Fabric, …). The actual values (S/M/L,
            Red/Green/Blue, …) are entered per product on the product form — see{" "}
            <code>/seller/products/new</code> — not here.
          </>
        }
      />
      <MasterDataManager
        label="attribute"
        items={attributes}
        onCreate={createAttributeAction}
        onUpdate={updateAttributeAction}
        onToggleActive={toggleAttributeActiveAction}
      />
    </PageContainer>
  );
}
