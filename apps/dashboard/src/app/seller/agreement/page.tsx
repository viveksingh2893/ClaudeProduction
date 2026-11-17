import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@kisan4u/db";
import { Card, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { SellerAgreementViewer } from "@/components/seller-agreement-viewer";

/** Account → Agreement: the seller's signed agreement, uploaded by Kisan4U admin (admin seller page's "Seller Agreement" tab). View only. */
export default async function SellerAgreementPage() {
  const session = await requireSession(["SELLER"]);
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, agreementStorageKey: true, agreementFileName: true, agreementUploadedAt: true },
  });
  if (!sellerProfile) redirect("/login");

  return (
    <PageContainer maxWidth="960px" className="py-8">
      <div className="mb-4">
        <Link
          href="/seller"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to seller dashboard
        </Link>
      </div>
      <PageHeader title="Seller Agreement" description="Your agreement with Kisan4U." />
      {sellerProfile.agreementStorageKey ? (
        <SellerAgreementViewer
          sellerProfileId={sellerProfile.id}
          fileName={sellerProfile.agreementFileName}
          uploadedAt={sellerProfile.agreementUploadedAt}
        />
      ) : (
        <Card className="p-6 text-sm text-gray-600">
          Your agreement hasn&apos;t been uploaded yet. Kisan4U will add it here once it&apos;s ready.
        </Card>
      )}
    </PageContainer>
  );
}
