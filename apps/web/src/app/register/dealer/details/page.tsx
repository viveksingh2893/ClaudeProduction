import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@kisan4u/db";
import { getVerifiedPhoneForOnboardingSession } from "@kisan4u/auth";
import { InfoCard, PageContainer, PageHeader } from "@kisan4u/ui";
import { DEALER_ONBOARDING_COOKIE } from "../onboarding-cookie";
import { DetailsForm } from "./details-form";

export default async function RegisterDealerDetailsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(DEALER_ONBOARDING_COOKIE)?.value;

  // No cookie, or a cookie referencing an expired/consumed/nonexistent
  // onboarding session -> bounced back to the start. This is what makes
  // typing this URL directly unreachable without first completing OTP
  // verification: there is no client-side gate here to bypass, the form
  // literally never renders without a valid server-side ticket.
  const phone = sessionId ? await getVerifiedPhoneForOnboardingSession(sessionId) : null;
  if (!phone) {
    redirect("/register/dealer");
  }

  const states = await prisma.indianState.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <PageContainer maxWidth="700px" className="py-10">
      <PageHeader
        title="Dealer Application"
        description="Partner with Kisan4U to access bulk pricing and a dedicated account experience."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoCard tone="earth" title="Bulk Pricing" description="Volume-based discounts." />
        <InfoCard tone="earth" title="Dedicated Support" description="A single point of contact." />
        <InfoCard tone="earth" title="Marketing Support" description="Co-branded promotions." />
        <InfoCard tone="earth" title="Early Access" description="First look at new stock." />
      </div>

      <DetailsForm phone={phone} states={states} />
    </PageContainer>
  );
}
