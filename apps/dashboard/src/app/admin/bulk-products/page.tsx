import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { DraftListManager } from "@/components/bulk-products/DraftListManager";
import {
  listBulkDraftsAction,
  createBulkDraftAction,
  renameBulkDraftAction,
  duplicateBulkDraftAction,
  deleteBulkDraftAction,
} from "./actions";

export default async function AdminBulkProductsPage() {
  await requireSession(["ADMIN"]);
  const drafts = await listBulkDraftsAction();

  return (
    <PageContainer maxWidth="1000px" className="py-8">
      <PageHeader
        title="Add Multiple Products"
        description="Bulk-edit multiple existing products at once (recall by Product ID) — reuses the exact same product services as the single-product edit form."
      />
      <DraftListManager
        drafts={drafts}
        basePath="/admin/bulk-products"
        onCreate={createBulkDraftAction}
        onRename={renameBulkDraftAction}
        onDuplicate={duplicateBulkDraftAction}
        onDelete={deleteBulkDraftAction}
      />
    </PageContainer>
  );
}
