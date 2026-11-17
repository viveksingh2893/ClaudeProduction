import type { Metadata } from "next";
import { prisma } from "@kisan4u/db";
import { InfoCard, PageContainer, PageHeader } from "@kisan4u/ui";
import { SellerApplyForm } from "./seller-apply-form";

export const metadata: Metadata = {
  title: "Become a Seller | Kisan4U",
  description:
    "Apply to sell on Kisan4U — list your products and reach customers and dealers nationwide.",
};

export default async function SellerApplyPage() {
  const states = await prisma.indianState.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001";

  return (
    <PageContainer maxWidth="760px" className="py-10">
      <PageHeader
        title="Become a Seller"
        description={
          <>
            List your products on Kisan4U and reach customers and dealers nationwide. Sellers manage
            their shop from the{" "}
            <a href={dashboardUrl} className="font-bold text-earth-700 hover:underline">
              Kisan4U Dashboard
            </a>{" "}
            once approved.
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoCard tone="earth" title="Massive Reach" description="Lakhs of customers & dealers." />
        <InfoCard
          tone="earth"
          title="Zero Listing Fees"
          description="Free for your first 3 months."
        />
        <InfoCard tone="earth" title="Logistics Support" description="Pickup & delivery handled." />
        <InfoCard tone="earth" title="Secure Payments" description="Fast, reliable payouts." />
      </div>

      <SellerApplyForm states={states.map((s) => s.name)} dashboardUrl={dashboardUrl} />
    </PageContainer>
  );
}
