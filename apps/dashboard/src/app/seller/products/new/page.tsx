import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { ProductForm } from "@/components/product-form";
import { loadReferenceData } from "../reference-data";
import {
  createProductAction,
  submitProductAction,
  removeVariantAction,
  removeAttributeValueAction,
  uploadProductImageAction,
  uploadVariantImageAction,
} from "../actions";

export default async function NewSellerProductPage() {
  const { sellerProfileId } = await requireApprovedSeller();
  const reference = await loadReferenceData(sellerProfileId);

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader title="New product" />
      <ProductForm
        reference={reference}
        sellerId={sellerProfileId}
        onSave={createProductAction}
        onSubmitForApproval={submitProductAction}
        onRemoveVariant={removeVariantAction}
        onRemoveAttributeValue={removeAttributeValueAction}
        onUploadProductImage={uploadProductImageAction}
        onUploadVariantImage={uploadVariantImageAction}
        submitLabel="Save draft"
        redirectBasePath="/seller/products"
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
