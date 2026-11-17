import { prisma } from "@kisan4u/db";
import { Breadcrumbs, Card, PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { ProfileForm } from "./profile-form";
import { CustomerStateSection } from "./customer-state-section";

export default async function ProfilePage() {
  const session = await requireSession(["CUSTOMER", "DEALER"]);

  // Read fresh from the DB rather than session.user.firstName/lastName —
  // the session JWT snapshots them at sign-in time and isn't updated by a
  // profile edit until the user's next login, so this page (and the
  // update action's own response) are the only places guaranteed to
  // reflect a just-saved name immediately.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      stateId: true,
      indianState: { select: { name: true } },
    },
  });

  const activeStates =
    session.user.role === "CUSTOMER"
      ? await prisma.indianState.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <PageContainer maxWidth="500px" className="py-8">
      <div className="mb-4">
        <Breadcrumbs items={[{ label: "Account", href: "/account" }, { label: "Profile" }]} />
      </div>
      <PageHeader title="Profile" description={user.phone} />

      <Card className="p-5">
        <ProfileForm initialFirstName={user.firstName ?? ""} initialLastName={user.lastName ?? ""} />
      </Card>

      {session.user.role === "CUSTOMER" && (
        <Card className="mt-4 p-5">
          <CustomerStateSection
            currentStateName={user.indianState?.name ?? null}
            states={activeStates}
          />
        </Card>
      )}
    </PageContainer>
  );
}
