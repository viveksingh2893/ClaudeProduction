import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireCouponsAccess } from "@/lib/coupons-guard";
import { CouponsTable } from "./coupons-table";

export default async function AdminCouponsPage() {
  await requireCouponsAccess();

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });

  return (
    <PageContainer className="py-8" maxWidth="1300px">
      <PageHeader
        title="Coupons"
        description="Create and manage discount coupons. Only Super Admin can create or edit coupons — applied at checkout on the storefront and in POS."
      />
      <CouponsTable
        coupons={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          audience: c.audience,
          discountType: c.discountType,
          discountValue: Number(c.discountValue),
          minPurchase: Number(c.minPurchase),
          maxDiscount: c.maxDiscount !== null ? Number(c.maxDiscount) : null,
          usageLimit: c.usageLimit,
          perUserLimit: c.perUserLimit,
          usageCount: c.usageCount,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate.toISOString(),
          isActive: c.isActive,
          createdAt: c.createdAt.toISOString(),
          redemptionCount: c._count.redemptions,
        }))}
      />
    </PageContainer>
  );
}
