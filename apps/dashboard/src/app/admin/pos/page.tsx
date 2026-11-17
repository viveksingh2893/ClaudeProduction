import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requirePosAccess } from "@/lib/pos-guard";
import { PosWorkspace } from "./pos-workspace";

export default async function PosPage() {
  await requirePosAccess();

  return (
    <PageContainer className="py-6" maxWidth="1600px">
      <PageHeader
        title="POS"
        description="Create an order on behalf of a registered customer or an approved dealer."
      />
      <PosWorkspace />
    </PageContainer>
  );
}
