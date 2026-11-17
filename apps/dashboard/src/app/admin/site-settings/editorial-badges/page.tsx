import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { EditorialBadgesManager } from "./editorial-badges-manager";

export default async function AdminEditorialBadgesPage() {
  await requireSession(["ADMIN"]);
  const badges = await prisma.editorialBadge.findMany({ orderBy: { position: "asc" } });

  return (
    <PageContainer className="py-8" maxWidth="900px">
      <PageHeader
        title="Editorial badges"
        description="Manage the badges available in every product's Editorial badge dropdown (admin-only field — Product Card Design Spec §Badge priority). Deactivating a badge removes it from new selections without touching products it's already assigned to."
      />
      <EditorialBadgesManager badges={badges} />
    </PageContainer>
  );
}
