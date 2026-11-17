import { notFound, redirect } from "next/navigation";
import { getProductForSellerEdit, assertOwnsProduct } from "@kisan4u/catalog";
import { AlertBox, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { buildProductFormInitial } from "@/lib/product-form-initial";
import { loadReferenceData } from "../../reference-data";
import { ProductForm } from "@/components/product-form";
import {
  updateProductAction,
  submitProductAction,
  removeVariantAction,
  removeAttributeValueAction,
  setDefaultVariantAction,
  uploadProductImageAction,
  uploadVariantImageAction,
} from "../../actions";

/**
 * Editing lives at its own route now (mirrors admin's
 * /admin/products/[id] review page vs /admin/products/[id]/edit split) —
 * /seller/products/[id] is always the rich review page, this is the only
 * place the actual form renders. Reachable for DRAFT/REJECTED (the normal
 * pre-approval editing case) AND APPROVED (editing a live listing — see
 * updateProductAction's doc comment: this uses the full strict schema and
 * automatically resubmits for admin re-review on save, pulling it off the
 * storefront until reviewed again). Anything else (SUBMITTED/SUSPENDED/
 * INACTIVE) redirects back to review rather than showing a form that
 * would just fail on save.
 */
export default async function EditSellerProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const { id } = await params;

  const owns = await assertOwnsProduct(sellerProfileId, id);
  if (!owns.ok) notFound();

  const product = await getProductForSellerEdit(id);
  if (!product) notFound();

  const editable =
    product.lifecycleStatus === "DRAFT" ||
    product.lifecycleStatus === "REJECTED" ||
    product.lifecycleStatus === "APPROVED";
  if (!editable) redirect(`/seller/products/${id}`);
  const isApprovedEdit = product.lifecycleStatus === "APPROVED";

  const reference = await loadReferenceData(sellerProfileId);
  const initial = buildProductFormInitial(product);

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader title="Edit product" />
      {product.lifecycleStatus === "REJECTED" && (
        <AlertBox tone="danger" title="Rejected" className="mb-6">
          {product.rejectionReason ?? "No reason given."} Edit and resubmit below.
        </AlertBox>
      )}
      {isApprovedEdit && (
        <AlertBox tone="warning" title="This product is currently live" className="mb-6">
          Saving will resubmit it for admin review, and it will come off the storefront until
          reviewed again — every mandatory field is required here, the same as Submit for
          approval.
        </AlertBox>
      )}
      <ProductForm
        reference={reference}
        initial={initial}
        sellerId={sellerProfileId}
        productId={product.id}
        onSave={updateProductAction.bind(null, product.id)}
        onSubmitForApproval={isApprovedEdit ? undefined : submitProductAction}
        onRemoveVariant={removeVariantAction}
        onRemoveAttributeValue={removeAttributeValueAction}
        onSetDefaultVariant={setDefaultVariantAction}
        onUploadProductImage={uploadProductImageAction}
        onUploadVariantImage={uploadVariantImageAction}
        submitLabel={isApprovedEdit ? "Save & resubmit for review" : "Save changes"}
        redirectBasePath="/seller/products"
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
        requireFullValidationOnSave={isApprovedEdit}
      />
    </PageContainer>
  );
}
