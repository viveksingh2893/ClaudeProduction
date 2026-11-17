import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BulkProductGrid } from "@/components/bulk-products/BulkProductGrid";
import { dbGroupsToState } from "@/components/bulk-products/convert";
import { loadAdminBulkReferenceData } from "../reference-data";
import {
  getBulkDraftAction,
  upsertBulkGroupAction,
  deleteBulkGroupAction,
  upsertBulkRowAction,
  deleteBulkRowAction,
  loadExistingProductForRecallAction,
  uploadBulkImageAction,
  uploadBulkImageFromUrlAction,
  validateBulkDraftAction,
  submitBulkDraftAction,
} from "../actions";

export default async function AdminBulkProductDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  await requireSession(["ADMIN"]);
  const [draft, reference] = await Promise.all([
    getBulkDraftAction(draftId),
    loadAdminBulkReferenceData(),
  ]);
  if (!draft) notFound();

  return (
    <PageContainer maxWidth="100%" className="px-4 py-6 sm:px-6">
      <PageHeader title={draft.name} description="Draft autosaves as you edit — Submit all when ready." />
      <BulkProductGrid
        draftId={draftId}
        isAdmin
        sellerId={null}
        reference={reference}
        initialGroups={dbGroupsToState(draft.groups)}
        initialVersion={draft.version}
        actions={{
          upsertGroup: upsertBulkGroupAction,
          deleteGroup: deleteBulkGroupAction,
          upsertRow: upsertBulkRowAction,
          deleteRow: deleteBulkRowAction,
          loadExistingProduct: loadExistingProductForRecallAction,
          uploadImage: uploadBulkImageAction,
          uploadImageFromUrl: uploadBulkImageFromUrlAction,
          validateDraft: validateBulkDraftAction,
          submitDraft: submitBulkDraftAction,
        }}
      />
    </PageContainer>
  );
}
