import { notFound, redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { getDealerProductDetail, isProductAvailableForState } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { AlertBox, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { RequestForm } from "./request-form";

export default async function NewProductRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; variantId?: string }>;
}) {
  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile) redirect("/login");
  if (profile.status !== "APPROVED") redirect("/dealer/status");
  if (!profile.stateId) notFound();

  const { productId, variantId } = await searchParams;
  if (!productId) notFound();

  // Same visibility+state rules as the catalogue/detail page — a dealer
  // can't reach this form for a product they couldn't otherwise see.
  // getDealerProductDetail already enforces conditions 2 & 3 of the
  // eligibility gate (approved/published product, explicitly configured
  // for dealers) by returning null otherwise. Condition 4 — unavailable in
  // the dealer's own verified state — is checked explicitly below: if the
  // product IS available, this form has nothing to do, so it 404s rather
  // than silently accepting a request the server would reject anyway.
  const product = await getDealerProductDetail(productId, profile.stateId);
  if (!product) notFound();
  if (isProductAvailableForState(product.dealerAvailableStates, profile.stateId)) notFound();

  const variant = variantId ? (product.variants.find((v) => v.id === variantId) ?? null) : null;
  const dealerState = await prisma.indianState.findUnique({
    where: { id: profile.stateId },
    select: { name: true },
  });

  return (
    <PageContainer maxWidth="600px" className="py-8">
      <PageHeader title="Request This Product" />
      <div className="mb-5">
        <AlertBox tone="info">
          This is an enquiry to the seller only — it is not an order, does not reserve stock, and
          does not calculate a final price.
        </AlertBox>
      </div>
      <RequestForm
        product={{ id: product.id, name: product.name }}
        variant={
          variant
            ? {
                id: variant.id,
                label: variant.values
                  .map((v) => `${v.attributeValue.attribute.name}: ${v.attributeValue.value}`)
                  .join(" / "),
              }
            : null
        }
        defaultAddress={profile.storeAddress ?? ""}
        dealerStateName={dealerState?.name ?? "—"}
      />
    </PageContainer>
  );
}
