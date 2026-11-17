import { redirect } from "next/navigation";
import { getSellerProfileForUser } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";
import { SignOutButton } from "../../sign-out-button";

// INACTIVE is part of the shared ApplicationStatus enum (added for
// Brand/Manufacturer's workflow) — no code path sets a SellerProfile to
// INACTIVE today, but the type is shared so this switch must stay
// exhaustive.
function statusCopy(
  status: "PENDING" | "REJECTED" | "SUSPENDED" | "INACTIVE",
  reason: string | null,
) {
  switch (status) {
    case "PENDING":
      return {
        heading: "Application pending review",
        body: "Your seller application is still being reviewed by an admin. Please check back later.",
      };
    case "REJECTED":
      return {
        heading: "Application rejected",
        body: `Your seller application was rejected.${reason ? ` Reason: ${reason}` : ""}`,
      };
    case "SUSPENDED":
      return {
        heading: "Account suspended",
        body: "Your seller account has been suspended. Contact support for details.",
      };
    case "INACTIVE":
      return {
        heading: "Account inactive",
        body: "Your seller account is inactive. Contact support for details.",
      };
  }
}

export default async function SellerStatusPage() {
  const session = await requireSession(["SELLER"]);

  const profile = await getSellerProfileForUser(session.user.id);
  if (!profile) {
    redirect("/login");
  }

  if (profile.status === "APPROVED") {
    redirect("/seller");
  }

  const copy = statusCopy(profile.status, profile.rejectionReason);

  return (
    <main style={{ padding: "3rem", maxWidth: 480, margin: "0 auto" }}>
      <h1>{copy.heading}</h1>
      <p>{copy.body}</p>
      <SignOutButton />
    </main>
  );
}
