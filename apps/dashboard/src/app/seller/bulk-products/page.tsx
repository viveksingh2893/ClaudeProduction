import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { DraftListManager } from "@/components/bulk-products/DraftListManager";
import {
  listBulkDraftsAction,
  createBulkDraftAction,
  renameBulkDraftAction,
  duplicateBulkDraftAction,
  deleteBulkDraftAction,
} from "./actions";

export default async function SellerBulkProductsPage() {
  await requireApprovedSeller();
  const drafts = await listBulkDraftsAction();

  return (
    <PageContainer maxWidth="1000px" className="py-8">
      <PageHeader
        title="Add Multiple Products"
        description="Create, edit, and submit several products — with or without variants, for Customer and/or Dealer — in one working session. Reuses the exact same product services as the single-product form."
      />
      <DraftListManager
        drafts={drafts}
        basePath="/seller/bulk-products"
        onCreate={createBulkDraftAction}
        onRename={renameBulkDraftAction}
        onDuplicate={duplicateBulkDraftAction}
        onDelete={deleteBulkDraftAction}
      />
    </PageContainer>
  );
}
