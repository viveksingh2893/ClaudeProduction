import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";
import { ReportsDownloadForm } from "./reports-download-form";

/**
 * Admin → Reports. Download the legacy-style Order Report and Product Wise
 * Report as `.xlsx` for a chosen date range. Same access as the rest of
 * the orders section — ADMIN or the order-scheduling ("Scheduling Team")
 * role.
 */
export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  await requireOrdersSectionView();

  return (
    <PageContainer maxWidth="900px" className="py-10">
      <PageHeader
        title="Reports"
        description="Download the Order Report and Product Wise Report for a date range."
      />
      <ReportsDownloadForm />
    </PageContainer>
  );
}
