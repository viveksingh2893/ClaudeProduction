import { listPestsDiseasesForAdmin } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  createPestDiseaseAction,
  updatePestDiseaseAction,
  togglePestDiseaseActiveAction,
  uploadPestDiseaseImageAction,
} from "./actions";

export default async function AdminPestsPage() {
  await requireSession(["ADMIN"]);
  const items = await listPestsDiseasesForAdmin();

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Pests & Diseases"
        description={
          <>
            The &ldquo;Shop by Pest &amp; Disease&rdquo; strip on the storefront home page, and one
            landing page per entry. Every active entry appears automatically. The emoji is shown until
            a real image is uploaded; tag products with a pest or disease from the product form&rsquo;s
            &ldquo;Category, brand &amp; classification&rdquo; section.
          </>
        }
      />
      <MasterDataManager
        label="Pest / Disease"
        items={items}
        hasImage
        hasEmoji
        emojiOptionalWithImage
        imageHint="Square (1:1) PNG with the background removed — shown on the home page's “Shop by Pest & Disease” strip instead of the emoji"
        onCreate={createPestDiseaseAction}
        onUpdate={updatePestDiseaseAction}
        onToggleActive={togglePestDiseaseActiveAction}
        onUploadImage={uploadPestDiseaseImageAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
