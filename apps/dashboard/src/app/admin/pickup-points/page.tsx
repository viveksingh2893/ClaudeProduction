import type { ApplicationStatus } from "@kisan4u/db";
import { prisma } from "@kisan4u/db";
import { getAllPickupPointsForAdmin } from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { PickupPointsTable } from "./pickup-points-table";

const STATUS_VALUES: ApplicationStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export default async function AdminPickupPointsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const approvalStatus = STATUS_VALUES.includes(sp.status as ApplicationStatus)
    ? (sp.status as ApplicationStatus)
    : undefined;
  const isActive = sp.active === "yes" ? true : sp.active === "no" ? false : undefined;

  const [{ rows: pickupPoints, total }, sellers] = await Promise.all([
    getAllPickupPointsForAdmin({
      q: sp.q,
      approvalStatus,
      isActive,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    prisma.sellerProfile.findMany({
      where: { status: "APPROVED" },
      select: { id: true, shopName: true },
      orderBy: { shopName: "asc" },
    }),
  ]);

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader title="Seller pickup points" />
      <PickupPointsTable
        pickupPoints={pickupPoints}
        sellers={sellers}
        total={total}
        page={page}
        pageSize={pageSize}
      />
    </PageContainer>
  );
}
