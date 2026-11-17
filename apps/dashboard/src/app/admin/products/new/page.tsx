import Link from "next/link";
import { prisma } from "@kisan4u/db";
import { Breadcrumbs, Button, FormSelect, PageContainer, PageHeader, SummaryCard } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { ProductForm } from "@/components/product-form";
import { loadReferenceData } from "../../../seller/products/reference-data";
import {
  adminCreateProductAction,
  adminSubmitNewProductAction,
  adminNewProductUploadImageAction,
  adminNewProductUploadVariantImageAction,
} from "./actions";
import { adminRemoveVariantAction, adminRemoveAttributeValueAction, adminSetDefaultVariantAction } from "../edit-actions";

/**
 * Admin creates a brand-new product directly on a seller's behalf — same
 * full form the seller themselves would use (seller/products/new/page.tsx),
 * the only difference being who the owning seller is: instead of coming
 * from the logged-in seller's own session, it's picked here from a
 * dropdown of every APPROVED seller and carried in the ?sellerId= query
 * param, so this page renders in two steps — pick a seller, then fill out
 * the product — rather than a single seller-scoped page.
 */
export default async function AdminNewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ sellerId?: string }>;
}) {
  await requireSession(["ADMIN"]);
  const { sellerId } = await searchParams;

  const sellers = await prisma.sellerProfile.findMany({
    where: { status: "APPROVED" },
    select: { id: true, shopName: true },
    orderBy: { shopName: "asc" },
  });

  const selectedSeller = sellerId ? sellers.find((s) => s.id === sellerId) : undefined;

  if (!selectedSeller) {
    return (
      <PageContainer maxWidth="600px" className="py-8">
        <PageHeader title="Add product" description="Choose which seller this product belongs to." />
        <SummaryCard title="Seller">
          {sellers.length === 0 ? (
            <p className="text-sm text-gray-600">There are no approved sellers yet.</p>
          ) : (
            <form action="/admin/products/new" method="GET" className="flex flex-col gap-4">
              <FormSelect
                name="sellerId"
                label="Seller"
                required
                defaultValue=""
                error={sellerId ? "That seller could not be found." : undefined}
              >
                <option value="" disabled>
                  Select a seller…
                </option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shopName}
                  </option>
                ))}
              </FormSelect>
              <Button type="submit">Continue</Button>
            </form>
          )}
        </SummaryCard>
      </PageContainer>
    );
  }

  const reference = await loadReferenceData(selectedSeller.id);

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Products", href: "/admin/products" },
            { label: "Add product" },
          ]}
        />
      </div>
      <PageHeader
        title="Add product"
        description={`Seller: ${selectedSeller.shopName}`}
        actions={
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800"
          >
            Change seller
          </Link>
        }
      />
      <ProductForm
        reference={reference}
        sellerId={selectedSeller.id}
        onSave={adminCreateProductAction.bind(null, selectedSeller.id)}
        onSubmitForApproval={adminSubmitNewProductAction.bind(null, selectedSeller.id)}
        onRemoveVariant={adminRemoveVariantAction}
        onRemoveAttributeValue={adminRemoveAttributeValueAction}
        onSetDefaultVariant={adminSetDefaultVariantAction}
        onUploadProductImage={adminNewProductUploadImageAction.bind(null, selectedSeller.id)}
        onUploadVariantImage={adminNewProductUploadVariantImageAction.bind(null, selectedSeller.id)}
        submitLabel="Save draft"
        redirectBasePath="/admin/products"
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
