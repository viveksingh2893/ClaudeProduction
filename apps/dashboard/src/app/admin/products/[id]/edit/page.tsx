import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs, PageContainer, PageHeader } from "@kisan4u/ui";
import { getProductForAdmin } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";
import { buildProductFormInitial } from "@/lib/product-form-initial";
import { loadAdminReferenceData } from "../../reference-data";
import { ProductForm } from "@/components/product-form";
import {
  adminUpdateProductAction,
  adminRemoveVariantAction,
  adminRemoveAttributeValueAction,
  adminSetDefaultVariantAction,
  adminUploadProductImageAction,
  adminUploadVariantImageAction,
} from "../../edit-actions";

/**
 * Admin edits a seller's product through the SAME full form the seller
 * uses (not a summary view) — general info, category, brand/manufacturer,
 * customer/dealer config, variants, images, SEO, and state availability are
 * all editable here. The product's owner never changes (there is no field
 * for it anywhere in this form); lifecycle status also never changes here
 * — approve/reject/suspend/reactivate/deactivate stay on the review page
 * below via ProductActions, so an edit to an already-APPROVED product
 * takes effect immediately without forcing re-approval, and an edit to a
 * DRAFT/SUBMITTED/REJECTED product does not accidentally approve it.
 */
export default async function AdminEditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { id } = await params;

  const product = await getProductForAdmin(id);
  if (!product) notFound();

  const reference = await loadAdminReferenceData(product.seller?.id ?? null);
  const initial = buildProductFormInitial(product);

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Products", href: "/admin/products" },
            { label: product.name, href: `/admin/products/${product.id}` },
            { label: "Edit" },
          ]}
        />
      </div>
      <PageHeader
        title="Edit product (admin)"
        description={`Status: ${product.lifecycleStatus} · Seller: ${product.seller ? product.seller.shopName : "In-house"}`}
        actions={
          <Link
            href={`/admin/products/${product.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to product review
          </Link>
        }
      />
      <ProductForm
        reference={reference}
        initial={initial}
        sellerId={product.seller?.id ?? null}
        isAdmin
        productId={product.id}
        onSave={adminUpdateProductAction.bind(null, product.id)}
        onRemoveVariant={adminRemoveVariantAction}
        onRemoveAttributeValue={adminRemoveAttributeValueAction}
        onSetDefaultVariant={adminSetDefaultVariantAction}
        {...(product.seller
          ? {
              onUploadProductImage: adminUploadProductImageAction,
              onUploadVariantImage: adminUploadVariantImageAction,
            }
          : {})}
        submitLabel="Save changes"
        redirectBasePath="/admin/products"
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
