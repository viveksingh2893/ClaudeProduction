import { listCropsForAdmin } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  createCropAction,
  updateCropAction,
  toggleCropActiveAction,
  uploadCropImageAction,
} from "./actions";

export default async function AdminCropsPage() {
  await requireSession(["ADMIN"]);
  const items = await listCropsForAdmin();

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Crops"
        description={
          <>
            The &ldquo;Shop by Crop&rdquo; strip on the storefront home page, and one landing page per
            crop. Every active crop appears automatically. The emoji is shown until a real image is
            uploaded; tag products with a crop from the product form&rsquo;s &ldquo;Category, brand
            &amp; classification&rdquo; section.
          </>
        }
      />
      <MasterDataManager
        label="Crop"
        items={items}
        hasImage
        hasEmoji
        emojiOptionalWithImage
        imageHint="Square (1:1) PNG with the background removed — shown on the home page's “Shop by Crop” strip instead of the emoji"
        onCreate={createCropAction}
        onUpdate={updateCropAction}
        onToggleActive={toggleCropActiveAction}
        onUploadImage={uploadCropImageAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
