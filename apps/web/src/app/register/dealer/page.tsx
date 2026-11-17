import { redirect } from "next/navigation";
import { prisma } from "@kisan4u/db";
import { getDealerApplicationForUser } from "@kisan4u/auth";
import { PageContainer } from "@kisan4u/ui";
import { auth } from "@/auth";
import { DealerRegisterPhoneStep } from "./phone-step";
import {
  LoggedInApplicationForm,
  type DealerApplicationPrefill,
} from "./logged-in-application-form";

/**
 * Smart entry point for "Become a Dealer". Branches on the live session so
 * every "Become a Dealer" link across the storefront lands somewhere that
 * makes sense:
 *
 *  - signed out → the phone + OTP onboarding step (DealerRegisterPhoneStep).
 *  - signed in as a customer → straight to the business-details form,
 *    prefilled from any existing PENDING / REJECTED application for edit +
 *    resubmit. Their role stays CUSTOMER until an admin approves.
 *  - signed in as a dealer → their dealer area (an approved dealer never
 *    sees this page; a pending one is routed to /dealer/status by it).
 *  - any other signed-in role → home.
 */
export default async function RegisterDealerPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    const { notice } = await searchParams;
    return <DealerRegisterPhoneStep tooManyAttempts={notice === "otp-attempts"} />;
  }

  const role = session.user.role;
  if (role === "DEALER") {
    redirect("/dealer/products");
  }
  if (role !== "CUSTOMER") {
    redirect("/");
  }

  const [application, states] = await Promise.all([
    getDealerApplicationForUser(session.user.id),
    prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  // A customer whose application is already APPROVED but whose role hasn't
  // flipped yet (they haven't re-authenticated) — send them to log in
  // again so the DEALER session is issued.
  if (application?.status === "APPROVED") {
    redirect("/dealer/status");
  }

  const status: "none" | "pending" | "rejected" =
    application?.status === "PENDING"
      ? "pending"
      : application?.status === "REJECTED"
        ? "rejected"
        : "none";

  const prefill: DealerApplicationPrefill = {
    name: application?.form.name ?? "",
    storeName: application?.form.storeName ?? "",
    storeAddress: application?.form.storeAddress ?? "",
    city: application?.form.city ?? "",
    stateId: application?.form.stateId ?? "",
    pincode: application?.form.pincode ?? "",
    gstNumber: application?.form.gstNumber ?? "",
    licenseNumber: application?.form.licenseNumber ?? "",
    gstDocUrl: application?.form.gstDocUrl ?? "",
    licenseDocUrl: application?.form.licenseDocUrl ?? "",
  };

  return (
    <PageContainer maxWidth="640px" className="py-8 sm:py-10">
      <LoggedInApplicationForm
        states={states.map((s) => ({ id: s.id, name: s.name }))}
        prefill={prefill}
        status={status}
        rejectionReason={application?.rejectionReason ?? null}
      />
    </PageContainer>
  );
}
